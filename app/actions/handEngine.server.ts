import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { blackjackEngine } from 'engines/blackjack/engine';
import { defaultRng } from 'engines/rng';
import { BlackjackStateSchema, type BlackjackState } from 'lib/gameState';
import type { BlackjackAction } from 'engines/blackjack/types';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
import {
  computeTurnDeadline,
  handAdvisoryLockKey,
  turnDeadlineService,
} from 'lib/turnDeadlineService.server';
import { isNaturalBlackjack } from 'lib/handMath';

/**
 * Engine-backed action layer. All game-state transitions flow through
 * `blackjackEngine.applyAction`. Side effects (DB writes, money movements)
 * are scheduled by this wrapper based on the engine's before/after state.
 *
 * Room model: rooms (casino_table rows) live independently of hands; the
 * room's roster lives in `seat` rows. `startBlackjackHand` consumes a
 * resolved participant list (humans + AI fills) from `tableLifecycle.server`
 * and creates the hand + hand_seat rows for a single round.
 *
 * Money model: bets are *reserved* (debited) at placement / cascade step.
 * On terminal settle, the engine emits one SettlementOrder per slot with
 * `delta = winnings - bet`; the wrapper credits the owning user
 * `bet + delta`.
 */

/** Shared room rules read from `casino_table` and passed to the engine. */
export type BlackjackRoomConfig = {
  minimumBet: number;
  maximumBet: number;
  numDecks: number;
  dealerHitsSoft17: boolean;
};

/**
 * One participant in a single hand. `seatId` is null for AI fills —
 * bots don't own a persistent seat at the room, they only exist within
 * the hand. Position determines the engine's player order.
 */
export type HandParticipant = {
  userId: string;
  seatId: string | null;
  position: number;
};

/**
 * Provision a fresh blackjack hand at an existing room. The participant
 * list is sorted by position so the engine's player order matches the
 * physical seat layout. Returns just `handId` — callers use the room URL
 * and look up the hand_seat for the viewer from there.
 */
export async function startBlackjackHand(params: {
  roomId: string;
  participants: HandParticipant[];
  config: BlackjackRoomConfig;
  /** Used for hand.created_by; usually the room creator who pressed Start. */
  creatorId: string;
}): Promise<{ handId: string }> {
  if (params.participants.length === 0) {
    throw new Error('startBlackjackHand: at least one participant required');
  }

  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let finalInitialState: BlackjackState | null = null;
  // Look up `is_ai` flags for every participant so we can decide whether
  // the first toAct needs a server-armed turn deadline.
  const participantUsers = await prisma.user.findMany({
    where: { id: { in: params.participants.map((p) => p.userId) } },
    select: { id: true, is_ai: true },
  });
  const isAiByUserId = new Map(participantUsers.map((u) => [u.id, u.is_ai]));

  const result = await prisma.$transaction(async (tx) => {
    // Pre-allocate one UUID per participant so engine player ids ==
    // hand_seat.id. The engine receives players in position order.
    const handId = randomUUID();
    const handSeatIds = params.participants.map(() => randomUUID());

    // slotId → is_ai, used to decide whether the first turn gets a clock.
    const slotIsAi = new Map<string, boolean>();
    for (let i = 0; i < params.participants.length; i++) {
      slotIsAi.set(handSeatIds[i], isAiByUserId.get(params.participants[i].userId) ?? false);
    }

    let initialState = blackjackEngine.initialState(params.config, handSeatIds, defaultRng);
    initialState = {
      ...initialState,
      turnDeadlineAt: computeTurnDeadline({
        toAct: initialState.toAct,
        isHuman: (slotId) => slotIsAi.get(slotId) === false,
      }),
    };
    finalInitialState = initialState;

    await tx.hand.create({
      data: {
        id: handId,
        table_id: params.roomId,
        created_by: params.creatorId,
        data: initialState as unknown as Prisma.JsonObject,
      },
    });

    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      await tx.hand_seat.create({
        data: {
          id: handSeatIds[i],
          hand_id: handId,
          seat_id: p.seatId, // null for AI fills
          user_id: p.userId,
          data: { cards: [] } as unknown as Prisma.JsonObject,
        },
      });
    }

    // Bootstrap the event log with the initial state so the hand can be
    // replayed deterministically from sequence 1.
    const bootstrapSeq = await appendHandEvent(
      handId,
      { action: HAND_INITIALIZED, actorId: null, payload: { initialState } },
      tx,
    );

    pendingBroadcasts.push({
      action: HAND_INITIALIZED,
      actor_id: null,
      payload: { initialState },
      sequence: bootstrapSeq,
      state_after: initialState,
    });

    return { handId };
  });

  // Publish post-commit so subscribers can never see a rolled-back event.
  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(result.handId, ev);
  }
  // Arm the very first turn's clock (if there is a human on it).
  if (finalInitialState) {
    rearmDeadline(result.handId, finalInitialState);
  }
  return result;
}

/**
 * Apply one action to a hand. The wrapper:
 *  - loads the engine state from `hand.data`,
 *  - enforces turn / legality via `engine.legalActions`,
 *  - applies the human action via `engine.applyAction`,
 *  - cascades any AI seats until control returns to the human or the hand
 *    reaches terminal,
 *  - auto-resolves the dealer phase if reached,
 *  - schedules money movements (reserve on bet, settle on terminal),
 *  - appends events for replay / SSE broadcast,
 *  - persists the new state snapshot.
 */
export async function submitAction(params: {
  handSeatId: string;
  action: BlackjackAction;
}): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let handIdForBroadcast = '';
  let finalState: BlackjackState | null = null;

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true },
    });
    if (!handSeat) {
      throw new Error('hand_seat not found');
    }
    handIdForBroadcast = handSeat.hand_id;

    // Advisory lock per hand: serializes this tx with any concurrent
    // timeout-fire tx for the same hand. Released at tx commit/rollback.
    await acquireHandLock(tx, handSeat.hand_id);

    const prevState: BlackjackState = BlackjackStateSchema.parse(handSeat.hand.data);

    // Build a slotId → user map covering every hand_seat row at the
    // table. Split siblings have synthetic ids (`${parentId}:split:N`)
    // that aren't valid UUIDs and have no hand_seat row, so they're
    // excluded here — `ownerOf` falls back to `parentSlotId` for them.
    const userMap = await buildUserMap(
      tx,
      prevState.players.filter((p) => p.parentSlotId == null).map((p) => p.id),
    );

    // After a split, the viewer owns multiple slots; per-turn actions
    // (hit/stay/double/surrender/split) target whichever of the viewer's
    // slots is currently to act, even though the form only carries the
    // primary handSeatId.
    let actionToApply: BlackjackAction = params.action;
    const turnActions = new Set(['hit', 'stay', 'double_down', 'surrender', 'split']);
    if (turnActions.has(params.action.kind)) {
      const acting = prevState.players.find(
        (p) =>
          (p.id === params.handSeatId || p.parentSlotId === params.handSeatId) &&
          p.id === prevState.toAct,
      );
      if (acting && acting.id !== (params.action as { playerId?: string }).playerId) {
        actionToApply = {
          ...(params.action as { playerId: string }),
          playerId: acting.id,
        } as BlackjackAction;
      }
    }

    // Turn / legality enforcement. `place_bet` has variable amount so it's
    // validated inside the engine (amount bounds + status check).
    if (actionToApply.kind !== 'place_bet') {
      const actorSlotId =
        actionToApply.kind === 'dealer_play' || actionToApply.kind === 'deal_initial'
          ? null
          : (actionToApply as { playerId: string }).playerId;
      const legal = blackjackEngine.legalActions(prevState, actorSlotId ?? params.handSeatId);
      const isLegal = legal.some((a) => a.kind === actionToApply.kind);
      if (!isLegal) {
        throw new Error(`action '${actionToApply.kind}' is not currently legal for this seat`);
      }
    }

    // 1. Apply the human action.
    const stateAfterHuman = blackjackEngine.applyAction(
      prevState,
      (actionToApply as { playerId?: string }).playerId ?? params.handSeatId,
      actionToApply,
      defaultRng,
    );
    await applyStepDiff(prevState, stateAfterHuman, userMap, actionToApply.kind, tx);
    const humanSeq = await appendHandEvent(
      handSeat.hand_id,
      { action: actionToApply.kind, actorId: params.handSeatId, payload: actionToApply },
      tx,
    );
    pendingBroadcasts.push({
      action: actionToApply.kind,
      actor_id: params.handSeatId,
      payload: actionToApply,
      sequence: humanSeq,
      state_after: stateAfterHuman,
    });

    // 2. Cascade AI seats while it's a bot's turn.
    let state = stateAfterHuman;
    while (
      !blackjackEngine.isTerminal(state) &&
      state.toAct !== null &&
      isAISlot(state.toAct, state, userMap)
    ) {
      const acting = state.toAct;
      const before = state;
      const aiAction = blackjackEngine.aiAction!(state, acting, defaultRng);
      state = blackjackEngine.applyAction(state, acting, aiAction, defaultRng);
      await applyStepDiff(before, state, userMap, aiAction.kind, tx);
      const seq = await appendHandEvent(
        handSeat.hand_id,
        { action: aiAction.kind, actorId: acting, payload: aiAction },
        tx,
      );
      pendingBroadcasts.push({
        action: aiAction.kind,
        actor_id: acting,
        payload: aiAction,
        sequence: seq,
        state_after: state,
      });
    }

    // 3. Dealer turn. The engine flips to `dealer` once every seat has
    //    finished acting; we play it through atomically so settle fires
    //    in the same transaction.
    if (state.phase === 'dealer') {
      const dealerAction: BlackjackAction = { kind: 'dealer_play' };
      state = blackjackEngine.applyAction(state, 'dealer', dealerAction, defaultRng);
      const dealerSeq = await appendHandEvent(
        handSeat.hand_id,
        { action: dealerAction.kind, actorId: null, payload: dealerAction },
        tx,
      );
      pendingBroadcasts.push({
        action: dealerAction.kind,
        actor_id: null,
        payload: dealerAction,
        sequence: dealerSeq,
        state_after: state,
      });
    }

    // 4. Terminal settlement: credit each slot's owning user.
    if (blackjackEngine.isTerminal(state)) {
      await applySettlement(state, userMap, tx);
    }

    // 5. Stamp the next turn's deadline before persisting. Only humans
    //    are on a clock; AI cascades run synchronously in the same tx.
    state = {
      ...state,
      turnDeadlineAt: computeTurnDeadline({
        toAct: state.toAct,
        isHuman: (slotId) => !isAISlot(slotId, state, userMap),
      }),
    };
    finalState = state;

    // 6. Persist new engine state.
    await tx.hand.update({
      where: { id: handSeat.hand_id },
      data: { data: state as unknown as Prisma.JsonObject },
    });
  });

  // Publish post-commit so subscribers can never see a rolled-back event.
  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handIdForBroadcast, ev);
  }

  // Arm or cancel the deadline timer for the next turn. Done after
  // commit so the timer is never armed against a state that rolls back.
  if (finalState) {
    rearmDeadline(handIdForBroadcast, finalState);
  }
}

type SlotOwner = { id: string; is_ai: boolean };

async function buildUserMap(
  tx: PrismaTransactionClient,
  slotIds: string[],
): Promise<Map<string, SlotOwner>> {
  const handSeats = await tx.hand_seat.findMany({
    where: { id: { in: slotIds } },
    include: { user: { select: { id: true, is_ai: true } } },
  });
  return new Map(handSeats.map((hs) => [hs.id, hs.user]));
}

/**
 * Resolve a slot's owning user, falling back to the parent slot for
 * split siblings (which exist in engine state but have no hand_seat row).
 */
function ownerOf(
  slotId: string,
  state: BlackjackState,
  userMap: Map<string, SlotOwner>,
): SlotOwner {
  const direct = userMap.get(slotId);
  if (direct) return direct;
  const slot = state.players.find((p) => p.id === slotId);
  if (slot?.parentSlotId) {
    const parent = userMap.get(slot.parentSlotId);
    if (parent) return parent;
  }
  throw new Error(`blackjack: unknown owner for slot ${slotId}`);
}

/** Slot id → hand_seat id (the parent hand_seat for splits, self otherwise). */
function ownerHandSeatId(state: BlackjackState, slotId: string): string {
  const slot = state.players.find((p) => p.id === slotId);
  return slot?.parentSlotId ?? slotId;
}

function isAISlot(slotId: string, state: BlackjackState, userMap: Map<string, SlotOwner>): boolean {
  return ownerOf(slotId, state, userMap).is_ai;
}

/**
 * For each slot whose `bet` or `insuranceBet` increased between prev and
 * next, debit the diff from the owning user. The atomic conditional
 * UPDATE in `recordMoneyTransaction` rejects insufficient funds at the
 * ledger level.
 */
async function applyStepDiff(
  prev: BlackjackState,
  next: BlackjackState,
  userMap: Map<string, SlotOwner>,
  actionKind: string,
  tx: PrismaTransactionClient,
): Promise<void> {
  for (const nextSlot of next.players) {
    const prevSlot = prev.players.find((p) => p.id === nextSlot.id);
    const prevBet = prevSlot?.bet ?? 0;
    const prevIns = prevSlot?.insuranceBet ?? null;

    // Bet increase (place_bet, double_down, or a freshly-spawned split sibling).
    if (nextSlot.bet > prevBet) {
      const owner = ownerOf(nextSlot.id, next, userMap);
      await recordMoneyTransaction(
        {
          userId: owner.id,
          type: 'debit',
          amount: nextSlot.bet - prevBet,
          gamePlayerId: ownerHandSeatId(next, nextSlot.id),
          note: `reserve:${actionKind}`,
        },
        tx,
      );
    }

    // Insurance taken for the first time.
    if (nextSlot.insuranceBet !== null && nextSlot.insuranceBet > 0 && prevIns === null) {
      const owner = ownerOf(nextSlot.id, next, userMap);
      await recordMoneyTransaction(
        {
          userId: owner.id,
          type: 'debit',
          amount: nextSlot.insuranceBet,
          gamePlayerId: ownerHandSeatId(next, nextSlot.id),
          note: 'reserve:insurance',
        },
        tx,
      );
    }
  }
}

/**
 * On terminal transition, credit each slot's owning user `bet + delta`
 * per the engine's settle output. Insurance wins (dealer natural BJ)
 * pay 3x the insurance reserve (2:1 winnings + original returned).
 */
async function applySettlement(
  state: BlackjackState,
  userMap: Map<string, SlotOwner>,
  tx: PrismaTransactionClient,
): Promise<void> {
  for (const order of blackjackEngine.settle(state)) {
    const player = state.players.find((p) => p.id === order.playerId);
    if (!player) continue;
    const credit = player.bet + order.delta;
    if (credit < 0) {
      throw new Error(
        `blackjack: unexpected negative settlement credit ${credit} for ${order.playerId}`,
      );
    }
    if (credit === 0) continue;

    const owner = ownerOf(order.playerId, state, userMap);
    await recordMoneyTransaction(
      {
        userId: owner.id,
        type: 'credit',
        amount: credit,
        gamePlayerId: ownerHandSeatId(state, order.playerId),
        note: `settle:${order.reason}`,
      },
      tx,
    );
  }

  // Insurance settlement: dealer had natural BJ iff the hand ended with
  // exactly 2 dealer cards totalling 21 (dealer never draws on natural).
  if (isNaturalBlackjack(state.dealerHand)) {
    for (const player of state.players) {
      if (player.insuranceBet && player.insuranceBet > 0) {
        const owner = ownerOf(player.id, state, userMap);
        await recordMoneyTransaction(
          {
            userId: owner.id,
            type: 'credit',
            amount: 3 * player.insuranceBet,
            gamePlayerId: ownerHandSeatId(state, player.id),
            note: 'settle:insurance_win',
          },
          tx,
        );
      }
    }
  }
}

/**
 * Translate a form-submit value + handSeatId into a typed BlackjackAction.
 * Throws on unknown / malformed input.
 */
export function parseBlackjackActionFromForm(
  submitValue: string,
  formData: FormData,
  handSeatId: string,
): BlackjackAction {
  switch (submitValue) {
    case 'place initial bet': {
      const raw = formData.get('amount')?.toString() ?? '';
      const amount = parseInt(raw, 10);
      if (!Number.isInteger(amount)) {
        throw new Error('invalid bet amount');
      }
      return { kind: 'place_bet', playerId: handSeatId, amount };
    }
    case 'take insurance': {
      const raw = formData.get('amount')?.toString() ?? '';
      const amount = parseInt(raw, 10);
      if (!Number.isInteger(amount)) {
        throw new Error('invalid insurance amount');
      }
      return { kind: 'take_insurance', playerId: handSeatId, amount };
    }
    case 'decline insurance':
      return { kind: 'decline_insurance', playerId: handSeatId };
    case 'hit':
      return { kind: 'hit', playerId: handSeatId };
    case 'stay':
      return { kind: 'stay', playerId: handSeatId };
    case 'double down':
      return { kind: 'double_down', playerId: handSeatId };
    case 'split':
      return { kind: 'split', playerId: handSeatId };
    case 'surrender':
      return { kind: 'surrender', playerId: handSeatId };
    default:
      throw new Error(`unknown submit value: ${submitValue}`);
  }
}

/**
 * Acquire a transaction-scoped Postgres advisory lock keyed on the hand
 * id. Serializes concurrent submitAction + fireBlackjackTurnTimeout
 * runs for the same hand so they never race on state updates. Released
 * automatically when the surrounding tx commits or rolls back.
 */
async function acquireHandLock(tx: PrismaTransactionClient, handId: string): Promise<void> {
  const key = handAdvisoryLockKey(handId);
  // Raw because Prisma's typed surface doesn't expose pg_advisory_xact_lock.
  // The cast goes through tx.$queryRawUnsafe with a literal key (bigint) —
  // no user input flows into the SQL.
  await tx.$queryRawUnsafe<unknown[]>(`SELECT pg_advisory_xact_lock(${key.toString()})`);
}

/**
 * Cancel any armed deadline for this hand; if the new state expects a
 * human on the clock, arm a fresh timer. Called post-commit.
 */
function rearmDeadline(handId: string, state: BlackjackState): void {
  const deadline = state.turnDeadlineAt;
  if (!deadline) {
    turnDeadlineService.cancel(handId);
    return;
  }
  turnDeadlineService.arm(handId, new Date(deadline), () => fireBlackjackTurnTimeout(handId));
}

/**
 * Apply an auto-action on behalf of the seat that timed out. The
 * server picks the action via `engine.aiAction` (passive: stay /
 * decline insurance / etc.). Tagged `timedOut: true` on the event
 * payload so audit / chat history can show it as an automatic move.
 *
 * Guards every step with an advisory lock and re-checks the deadline
 * after acquiring it — a real action may have landed between the
 * timer being scheduled and now firing.
 */
export async function fireBlackjackTurnTimeout(handId: string): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let finalState: BlackjackState | null = null;

  await prisma.$transaction(async (tx) => {
    await acquireHandLock(tx, handId);

    const hand = await tx.hand.findUnique({ where: { id: handId } });
    if (!hand) return; // hand vanished (room archive, etc.) — nothing to do

    const state: BlackjackState = BlackjackStateSchema.parse(hand.data);

    // Recheck: action may have landed; deadline may have moved.
    if (state.toAct === null) return;
    if (state.turnDeadlineAt === null) return;
    const deadline = new Date(state.turnDeadlineAt).getTime();
    if (Date.now() < deadline) {
      // Spurious fire (woke up too early because of timer drift) —
      // re-arm and bail.
      finalState = state;
      return;
    }

    const userMap = await buildUserMap(
      tx,
      state.players.filter((p) => p.parentSlotId == null).map((p) => p.id),
    );

    // Sanity: don't auto-act on an AI seat (cascade should have run already).
    if (isAISlot(state.toAct, state, userMap)) return;

    const acting = state.toAct;
    const autoAction = blackjackEngine.aiAction!(state, acting, defaultRng);
    let next = blackjackEngine.applyAction(state, acting, autoAction, defaultRng);
    await applyStepDiff(state, next, userMap, autoAction.kind, tx);
    const seq = await appendHandEvent(
      handId,
      {
        action: autoAction.kind,
        actorId: acting,
        payload: { ...autoAction, timedOut: true },
      },
      tx,
    );
    pendingBroadcasts.push({
      action: autoAction.kind,
      actor_id: acting,
      payload: { ...autoAction, timedOut: true },
      sequence: seq,
      state_after: next,
    });

    // Cascade AI seats following the timed-out player.
    while (
      !blackjackEngine.isTerminal(next) &&
      next.toAct !== null &&
      isAISlot(next.toAct, next, userMap)
    ) {
      const aiActing = next.toAct;
      const before = next;
      const aiAction = blackjackEngine.aiAction!(next, aiActing, defaultRng);
      next = blackjackEngine.applyAction(next, aiActing, aiAction, defaultRng);
      await applyStepDiff(before, next, userMap, aiAction.kind, tx);
      const aiSeq = await appendHandEvent(
        handId,
        { action: aiAction.kind, actorId: aiActing, payload: aiAction },
        tx,
      );
      pendingBroadcasts.push({
        action: aiAction.kind,
        actor_id: aiActing,
        payload: aiAction,
        sequence: aiSeq,
        state_after: next,
      });
    }

    // Dealer phase + settlement, same path as submitAction.
    if (next.phase === 'dealer') {
      const dealerAction: BlackjackAction = { kind: 'dealer_play' };
      next = blackjackEngine.applyAction(next, 'dealer', dealerAction, defaultRng);
      const dealerSeq = await appendHandEvent(
        handId,
        { action: dealerAction.kind, actorId: null, payload: dealerAction },
        tx,
      );
      pendingBroadcasts.push({
        action: dealerAction.kind,
        actor_id: null,
        payload: dealerAction,
        sequence: dealerSeq,
        state_after: next,
      });
    }
    if (blackjackEngine.isTerminal(next)) {
      await applySettlement(next, userMap, tx);
    }

    next = {
      ...next,
      turnDeadlineAt: computeTurnDeadline({
        toAct: next.toAct,
        isHuman: (slotId) => !isAISlot(slotId, next, userMap),
      }),
    };
    finalState = next;

    await tx.hand.update({
      where: { id: handId },
      data: { data: next as unknown as Prisma.JsonObject },
    });
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handId, ev);
  }
  if (finalState) {
    rearmDeadline(handId, finalState);
  }
}
