import { randomUUID } from 'node:crypto';
import type { Prisma, user } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { blackjackEngine } from 'engines/blackjack/engine';
import { defaultRng } from 'engines/rng';
import { BlackjackStateSchema, type BlackjackState } from 'lib/gameState';
import type { BlackjackAction } from 'engines/blackjack/types';
import { DEFAULT_MAXIMUM_BET, DEFAULT_MINIMUM_BET } from 'constants/index';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
import { isNaturalBlackjack } from 'lib/handMath';
import { getAvailableAIUsers } from 'auth/aiUsers.server';

/**
 * Engine-backed action layer. All game-state transitions flow through
 * `blackjackEngine.applyAction`. Side effects (DB writes, money movements)
 * are scheduled by this wrapper based on the engine's before/after state.
 *
 * Multi-seat: tables can be provisioned with N seats; the human takes
 * position 1, the rest are filled with AI users from the pool. After the
 * human acts, the wrapper runs an AI cascade until either the hand
 * reaches a terminal state or control returns to the human. The dealer
 * phase is then resolved in the same transaction.
 *
 * Money model: bets are *reserved* (debited) at placement / cascade
 * step. On terminal settle, the engine emits one SettlementOrder per
 * slot with `delta = winnings - bet`; the wrapper credits the owning
 * user `bet + delta`.
 */

export type CreateHandResult = {
  handId: string;
  handSeatId: string;
  tableId: string;
  seatId: string;
};

export async function createNewHand(params: {
  user: user;
  gameType: string;
  minimumBet?: number;
  maximumBet?: number;
  numDecks?: number;
  dealerHitsSoft17?: boolean;
  /** Total seats at the table. Empty seats are filled with AI users. */
  numSeats?: number;
}): Promise<CreateHandResult> {
  if (params.gameType !== 'blackjack') {
    throw new Error(`unsupported game type: ${params.gameType}`);
  }
  const minimumBet = params.minimumBet ?? DEFAULT_MINIMUM_BET;
  const maximumBet = params.maximumBet ?? DEFAULT_MAXIMUM_BET;
  const numDecks = params.numDecks ?? 1;
  const dealerHitsSoft17 = params.dealerHitsSoft17 ?? false;
  const numSeats = params.numSeats ?? 1;
  if (numSeats < 1) {
    throw new Error('blackjack: numSeats must be ≥ 1');
  }

  // Pull `numSeats - 1` bots for the empty seats. AI users have huge
  // balances by design so they never break a table's bet bounds.
  const aiUsers = numSeats > 1 ? await getAvailableAIUsers(numSeats - 1) : [];
  if (aiUsers.length < numSeats - 1) {
    throw new Error('blackjack: not enough AI users in the pool');
  }

  const pendingBroadcasts: BroadcastedHandEvent[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const table = await tx.casino_table.create({
      data: {
        game_type: params.gameType,
        minimum_bet: minimumBet,
        maximum_bet: maximumBet,
        max_seats: numSeats,
        created_by: params.user.id,
      },
    });

    const humanSeat = await tx.seat.create({
      data: {
        table_id: table.id,
        user_id: params.user.id,
        position: 1,
      },
    });
    const aiSeatIds: string[] = [];
    for (let i = 0; i < aiUsers.length; i++) {
      const s = await tx.seat.create({
        data: {
          table_id: table.id,
          user_id: aiUsers[i].id,
          position: i + 2,
        },
      });
      aiSeatIds.push(s.id);
    }

    // Pre-allocate UUIDs so the engine's player id == hand_seat.id.
    const handId = randomUUID();
    const humanHandSeatId = randomUUID();
    const aiHandSeatIds = aiUsers.map(() => randomUUID());
    const playerIds = [humanHandSeatId, ...aiHandSeatIds];

    const initialState = blackjackEngine.initialState(
      { minimumBet, maximumBet, numDecks, dealerHitsSoft17 },
      playerIds,
      defaultRng,
    );

    await tx.hand.create({
      data: {
        id: handId,
        table_id: table.id,
        created_by: params.user.id,
        data: initialState as unknown as Prisma.JsonObject,
      },
    });

    await tx.hand_seat.create({
      data: {
        id: humanHandSeatId,
        hand_id: handId,
        seat_id: humanSeat.id,
        user_id: params.user.id,
        data: { cards: [] } as unknown as Prisma.JsonObject,
      },
    });
    for (let i = 0; i < aiUsers.length; i++) {
      await tx.hand_seat.create({
        data: {
          id: aiHandSeatIds[i],
          hand_id: handId,
          seat_id: aiSeatIds[i],
          user_id: aiUsers[i].id,
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

    return {
      handId,
      handSeatId: humanHandSeatId,
      tableId: table.id,
      seatId: humanSeat.id,
    };
  });

  // Publish post-commit so subscribers can never see a rolled-back event.
  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(result.handId, ev);
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

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true },
    });
    if (!handSeat) {
      throw new Error('hand_seat not found');
    }
    handIdForBroadcast = handSeat.hand_id;

    const prevState: BlackjackState = BlackjackStateSchema.parse(handSeat.hand.data);

    // Build a slotId → user map covering every hand_seat row at the
    // table (primary slots only — split siblings resolve via parentSlotId).
    const userMap = await buildUserMap(tx, prevState.players.map((p) => p.id));

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

    // 5. Persist new engine state.
    await tx.hand.update({
      where: { id: handSeat.hand_id },
      data: { data: state as unknown as Prisma.JsonObject, updated_at: new Date() },
    });
  });

  // Publish post-commit so subscribers can never see a rolled-back event.
  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handIdForBroadcast, ev);
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

function isAISlot(
  slotId: string,
  state: BlackjackState,
  userMap: Map<string, SlotOwner>,
): boolean {
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
    if (
      nextSlot.insuranceBet !== null &&
      nextSlot.insuranceBet > 0 &&
      prevIns === null
    ) {
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
