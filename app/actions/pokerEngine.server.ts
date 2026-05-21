import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { fiveCardDrawEngine } from 'engines/poker/fiveCardDraw/engine';
import type { FiveCardDrawAction, FiveCardDrawState } from 'engines/poker/fiveCardDraw/types';
import { FiveCardDrawStateSchema } from 'engines/poker/fiveCardDraw/state.schema';
import { defaultRng } from 'engines/rng';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
import {
  computeTurnDeadline,
  handAdvisoryLockKey,
  turnDeadlineService,
} from 'lib/turnDeadlineService.server';
import type { HandParticipant } from './handEngine.server';
import { runAiCascade } from 'engines/aiRunner';

/**
 * 5-card draw wrapper. Mirrors the structure of `handEngine.server.ts`
 * for blackjack: consumes a resolved participant list (humans from
 * persistent seats + AI fills) from `tableLifecycle.server`, runs the
 * AI cascade between human actions, and applies poker's per-player chip
 * diffs against `user.money`.
 *
 * Money model:
 *   At hand start, each player's stack is read from `user.money`. The
 *   engine debits the ante. The wrapper records every increase in
 *   `player.totalBet` as a debit against the owning user. At showdown
 *   `engine.settle()` returns one SettlementOrder per slot with
 *   `delta = winnings - totalBet`; the wrapper credits each user
 *   `totalBet + delta = winnings`.
 */

export type PokerRoomConfig = {
  ante: number;
  minBet: number;
  maxBet: number;
  /** Used to cap how much a player brings to the table from their wallet. */
  minimumBuyIn: number;
  maximumBuyIn: number;
};

/**
 * Provision a fresh 5-card draw hand at an existing room. AI participants
 * always bring the table maximum to the felt; humans bring their wallet
 * capped at the table max. Returns just `handId` — callers find their
 * hand_seat from the room URL.
 */
export async function startPokerHand(params: {
  roomId: string;
  participants: HandParticipant[];
  config: PokerRoomConfig;
  creatorId: string;
}): Promise<{ handId: string }> {
  if (params.participants.length < 2) {
    throw new Error('startPokerHand: poker needs at least 2 participants');
  }
  const cfg = params.config;

  // Look up each user's wallet to size their buy-in. AI users have
  // huge balances; humans bring whatever they have (capped at table max).
  const userIds = params.participants.map((p) => p.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, money: true, is_ai: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let finalInitialState: FiveCardDrawState | null = null;
  let resultHandId = '';

  const result = await prisma.$transaction(async (tx) => {
    const handId = randomUUID();
    resultHandId = handId;
    const handSeatIds = params.participants.map(() => randomUUID());
    const playerIds = handSeatIds;

    // Stacks per participant in position order.
    const stacks: Record<string, number> = {};
    const slotIsAi = new Map<string, boolean>();
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      const u = userById.get(p.userId);
      if (!u) throw new Error(`startPokerHand: user ${p.userId} not found`);
      const buyIn = u.is_ai ? cfg.maximumBuyIn : Math.min(u.money, cfg.maximumBuyIn);
      stacks[handSeatIds[i]] = buyIn;
      slotIsAi.set(handSeatIds[i], u.is_ai);
    }

    let initialState = fiveCardDrawEngine.initialState(
      { ante: cfg.ante, minBet: cfg.minBet, stacks },
      playerIds,
      defaultRng,
    );
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
          data: {} as unknown as Prisma.JsonObject,
        },
      });
    }

    // Debit the ante from each user — atomic (AI users have huge balances).
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      await recordMoneyTransaction(
        {
          userId: p.userId,
          type: 'debit',
          amount: cfg.ante,
          gamePlayerId: handSeatIds[i],
          note: 'reserve:ante',
        },
        tx,
      );
    }

    // Bootstrap event log.
    const bootSeq = await appendHandEvent(
      handId,
      { action: HAND_INITIALIZED, actorId: null, payload: { initialState } },
      tx,
    );
    pendingBroadcasts.push({
      action: HAND_INITIALIZED,
      actor_id: null,
      payload: { initialState },
      sequence: bootSeq,
      state_after: initialState as unknown as never,
    });

    // If first-to-act is an AI seat, cascade in this tx until control
    // lands on a human (or the hand goes terminal). Otherwise the table
    // would deadlock — AI seats have no turn-timeout to kick them.
    const userMap = new Map<string, { id: string; is_ai: boolean }>(
      handSeatIds.map((slotId, i) => {
        const u = userById.get(params.participants[i].userId)!;
        return [slotId, { id: u.id, is_ai: u.is_ai }];
      }),
    );
    const isAI = (slotId: string) => userMap.get(slotId)?.is_ai === true;
    let cursor: FiveCardDrawState = initialState;
    while (!fiveCardDrawEngine.isTerminal(cursor) && cursor.toAct !== null && isAI(cursor.toAct)) {
      const acting = cursor.toAct;
      const before = cursor;
      const aiAction = fiveCardDrawEngine.aiAction!(cursor, acting, defaultRng);
      cursor = fiveCardDrawEngine.applyAction(cursor, acting, aiAction, defaultRng);
      await applyDiffs(before, cursor, userMap, tx, aiAction.kind);
      const aiSeq = await appendHandEvent(
        handId,
        { action: aiAction.kind, actorId: acting, payload: aiAction },
        tx,
      );
      pendingBroadcasts.push({
        action: aiAction.kind,
        actor_id: acting,
        payload: aiAction,
        sequence: aiSeq,
        state_after: cursor as unknown as never,
      });
    }
    if (fiveCardDrawEngine.isTerminal(cursor)) {
      for (const order of fiveCardDrawEngine.settle(cursor)) {
        const slot = cursor.players.find((p) => p.id === order.playerId);
        if (!slot) continue;
        const credit = slot.totalBet + order.delta;
        if (credit <= 0) continue;
        const u = userMap.get(slot.id);
        if (!u) throw new Error(`startPokerHand: unknown owner for slot ${slot.id}`);
        await recordMoneyTransaction(
          {
            userId: u.id,
            type: 'credit',
            amount: credit,
            gamePlayerId: slot.id,
            note: `settle:${order.reason}`,
          },
          tx,
        );
      }
    }
    if (cursor !== initialState) {
      cursor = {
        ...cursor,
        turnDeadlineAt: computeTurnDeadline({
          toAct: cursor.toAct,
          isHuman: (slotId) => userMap.get(slotId)?.is_ai === false,
        }),
      };
      finalInitialState = cursor;
      await tx.hand.update({
        where: { id: handId },
        data: { data: cursor as unknown as Prisma.JsonObject },
      });
    }

    return { handId };
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(result.handId, ev);
  }
  if (finalInitialState) {
    rearmPokerDeadline(resultHandId, finalInitialState);
  }
  return result;
}

/**
 * Apply a player's action to a 5-card draw hand. Cascades any AI seats
 * that follow until control returns to a human (or the hand ends).
 */
export async function submitPokerAction(params: {
  handSeatId: string;
  action: FiveCardDrawAction;
}): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let handIdForBroadcast = '';
  let finalState: FiveCardDrawState | null = null;

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true, user: true },
    });
    if (!handSeat) {
      throw new Error('pokerEngine: hand_seat not found');
    }
    handIdForBroadcast = handSeat.hand_id;

    await acquirePokerHandLock(tx, handSeat.hand_id);

    let state = parseState(handSeat.hand.data);
    if (state.toAct !== params.handSeatId) {
      throw new Error('pokerEngine: not your turn');
    }

    const userMap = await buildUserMap(
      tx,
      state.players.map((p) => p.id),
    );

    // 1. Apply the human action.
    const beforeHuman = state;
    state = fiveCardDrawEngine.applyAction(state, params.handSeatId, params.action, defaultRng);
    await applyDiffs(beforeHuman, state, userMap, tx, params.action.kind);
    const humanSeq = await appendHandEvent(
      handSeat.hand_id,
      { action: params.action.kind, actorId: params.handSeatId, payload: params.action },
      tx,
    );
    pendingBroadcasts.push({
      action: params.action.kind,
      actor_id: params.handSeatId,
      payload: params.action,
      sequence: humanSeq,
      state_after: state as unknown as never,
    });

    // 2. Cascade AI turns while it's a bot's turn.
    const isAI = (slotId: string) => userMap.get(slotId)?.is_ai === true;
    let cursor = state;
    while (!fiveCardDrawEngine.isTerminal(cursor) && cursor.toAct !== null && isAI(cursor.toAct)) {
      const acting = cursor.toAct;
      const beforeAI = cursor;
      const aiAction = fiveCardDrawEngine.aiAction!(cursor, acting, defaultRng);
      cursor = fiveCardDrawEngine.applyAction(cursor, acting, aiAction, defaultRng);
      await applyDiffs(beforeAI, cursor, userMap, tx, aiAction.kind);
      const aiSeq = await appendHandEvent(
        handSeat.hand_id,
        { action: aiAction.kind, actorId: acting, payload: aiAction },
        tx,
      );
      pendingBroadcasts.push({
        action: aiAction.kind,
        actor_id: acting,
        payload: aiAction,
        sequence: aiSeq,
        state_after: cursor as unknown as never,
      });
    }
    state = cursor;

    // 3. If the hand has settled, credit pot awards.
    if (fiveCardDrawEngine.isTerminal(state)) {
      for (const order of fiveCardDrawEngine.settle(state)) {
        const slot = state.players.find((p) => p.id === order.playerId);
        if (!slot) continue;
        const credit = slot.totalBet + order.delta;
        if (credit <= 0) continue;
        const u = userMap.get(slot.id);
        if (!u) throw new Error(`pokerEngine: unknown owner for slot ${slot.id}`);
        await recordMoneyTransaction(
          {
            userId: u.id,
            type: 'credit',
            amount: credit,
            gamePlayerId: slot.id,
            note: `settle:${order.reason}`,
            idempotencyKey: `settle:${slot.id}`,
          },
          tx,
        );
      }
    }

    // 4. Stamp turn deadline + persist.
    state = {
      ...state,
      turnDeadlineAt: computeTurnDeadline({
        toAct: state.toAct,
        isHuman: (slotId) => userMap.get(slotId)?.is_ai === false,
      }),
    };
    finalState = state;
    await tx.hand.update({
      where: { id: handSeat.hand_id },
      data: { data: state as unknown as Prisma.JsonObject },
    });
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handIdForBroadcast, ev);
  }
  if (finalState) {
    rearmPokerDeadline(handIdForBroadcast, finalState);
  }
}

/**
 * For each slot whose totalBet increased, debit the diff from the
 * owning user. The atomic conditional UPDATE in `recordMoneyTransaction`
 * rejects insufficient funds at the ledger level.
 */
async function applyDiffs(
  prev: FiveCardDrawState,
  next: FiveCardDrawState,
  userMap: Map<string, { id: string; is_ai: boolean }>,
  tx: PrismaTransactionClient,
  actionKind: string,
): Promise<void> {
  for (const nextSlot of next.players) {
    const prevSlot = prev.players.find((p) => p.id === nextSlot.id);
    const prevBet = prevSlot?.totalBet ?? 0;
    const diff = nextSlot.totalBet - prevBet;
    if (diff > 0) {
      const u = userMap.get(nextSlot.id);
      if (!u) throw new Error(`pokerEngine: unknown owner for slot ${nextSlot.id}`);
      await recordMoneyTransaction(
        {
          userId: u.id,
          type: 'debit',
          amount: diff,
          gamePlayerId: nextSlot.id,
          note: `reserve:${actionKind}`,
        },
        tx,
      );
    }
  }
}

async function buildUserMap(
  tx: PrismaTransactionClient,
  slotIds: string[],
): Promise<Map<string, { id: string; is_ai: boolean }>> {
  const handSeats = await tx.hand_seat.findMany({
    where: { id: { in: slotIds } },
    include: { user: { select: { id: true, is_ai: true } } },
  });
  return new Map(handSeats.map((hs) => [hs.id, hs.user]));
}

function parseState(raw: unknown): FiveCardDrawState {
  return FiveCardDrawStateSchema.parse(raw) as FiveCardDrawState;
}

/**
 * Translate a form-submit value into a typed FiveCardDrawAction.
 *
 * Form fields used:
 *   submit: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'discard'
 *   amount: numeric (for bet / raise)
 *   indices: comma-separated 0-4 (for discard)
 */
export function parsePokerActionFromForm(
  submitValue: string,
  formData: FormData,
  handSeatId: string,
): FiveCardDrawAction {
  switch (submitValue) {
    case 'fold':
      return { kind: 'fold', playerId: handSeatId };
    case 'check':
      return { kind: 'check', playerId: handSeatId };
    case 'call':
      return { kind: 'call', playerId: handSeatId };
    case 'bet': {
      const raw = formData.get('amount')?.toString() ?? '';
      const amount = parseInt(raw, 10);
      if (!Number.isFinite(amount)) throw new Error('invalid bet amount');
      return { kind: 'bet', playerId: handSeatId, amount };
    }
    case 'raise': {
      const raw = formData.get('amount')?.toString() ?? '';
      const amount = parseInt(raw, 10);
      if (!Number.isFinite(amount)) throw new Error('invalid raise amount');
      return { kind: 'raise', playerId: handSeatId, amount };
    }
    case 'discard': {
      const raw = formData.get('indices')?.toString() ?? '';
      const indices = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => parseInt(s, 10));
      for (const i of indices) {
        if (!Number.isInteger(i) || i < 0 || i > 4) {
          throw new Error(`invalid discard index ${i}`);
        }
      }
      return { kind: 'discard', playerId: handSeatId, indices };
    }
    default:
      throw new Error(`unknown poker submit value: ${submitValue}`);
  }
}

void runAiCascade; // exported as an indirect smoke import — keeps the file's intent obvious.

/** Per-hand tx-scoped advisory lock, same pattern as handEngine. */
async function acquirePokerHandLock(tx: PrismaTransactionClient, handId: string): Promise<void> {
  const key = handAdvisoryLockKey(handId);
  // $executeRawUnsafe — the function returns void; $queryRaw* fails on void.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${key.toString()})`);
}

function rearmPokerDeadline(handId: string, state: FiveCardDrawState): void {
  const deadline = state.turnDeadlineAt;
  if (!deadline) {
    turnDeadlineService.cancel(handId);
    return;
  }
  turnDeadlineService.arm(handId, new Date(deadline), () => firePokerTurnTimeout(handId));
}

/**
 * Server-side timeout handler for 5-Card Draw. Reuses
 * `fiveCardDrawEngine.aiAction` for the passive auto-action (fold or
 * check, depending on owed). Same advisory-lock + recheck-deadline
 * pattern as the blackjack handler.
 */
export async function firePokerTurnTimeout(handId: string): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let finalState: FiveCardDrawState | null = null;

  await prisma.$transaction(async (tx) => {
    await acquirePokerHandLock(tx, handId);
    const hand = await tx.hand.findUnique({
      where: { id: handId },
      include: { casino_table: { select: { created_by: true } } },
    });
    if (!hand) return;
    const state = parseState(hand.data);
    if (state.toAct === null || !state.turnDeadlineAt) return;
    if (Date.now() < new Date(state.turnDeadlineAt).getTime()) {
      finalState = state; // re-arm
      return;
    }
    const userMap = await buildUserMap(
      tx,
      state.players.map((p) => p.id),
    );
    if (userMap.get(state.toAct)?.is_ai !== false) return; // not a human on the clock

    const acting = state.toAct;
    // 5cd timeouts fold during the two betting rounds — same reasoning
    // as Hold'em (don't let a walked-away player call into a live bet).
    // During the draw phase, fold isn't legal; stand pat (discard
    // nothing) instead so the round can advance.
    const auto: FiveCardDrawAction =
      state.phase === 'draw'
        ? { kind: 'discard', playerId: acting, indices: [] }
        : { kind: 'fold', playerId: acting };
    let cursor = fiveCardDrawEngine.applyAction(state, acting, auto, defaultRng);
    await applyDiffs(state, cursor, userMap, tx, auto.kind);
    const seq = await appendHandEvent(
      handId,
      { action: auto.kind, actorId: acting, payload: { ...auto, timedOut: true } },
      tx,
    );
    pendingBroadcasts.push({
      action: auto.kind,
      actor_id: acting,
      payload: { ...auto, timedOut: true },
      sequence: seq,
      state_after: cursor as unknown as never,
    });

    // Sit out the timed-out player for subsequent hands. Same exception
    // as Hold'em: the room creator stays in rotation since they're the
    // only one who can start the next hand.
    const actingSeat = await tx.hand_seat.findUnique({
      where: { id: acting },
      select: { seat_id: true, user_id: true },
    });
    const isCreator = actingSeat?.user_id === hand.casino_table.created_by;
    if (actingSeat?.seat_id && !isCreator) {
      await tx.seat.update({
        where: { id: actingSeat.seat_id },
        data: { sitting_out: true },
      });
    }

    // Continue the AI cascade.
    const isAI = (slotId: string) => userMap.get(slotId)?.is_ai === true;
    while (!fiveCardDrawEngine.isTerminal(cursor) && cursor.toAct !== null && isAI(cursor.toAct)) {
      const aiActing = cursor.toAct;
      const before = cursor;
      const aiAction = fiveCardDrawEngine.aiAction!(cursor, aiActing, defaultRng);
      cursor = fiveCardDrawEngine.applyAction(cursor, aiActing, aiAction, defaultRng);
      await applyDiffs(before, cursor, userMap, tx, aiAction.kind);
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
        state_after: cursor as unknown as never,
      });
    }

    // Settlement.
    if (fiveCardDrawEngine.isTerminal(cursor)) {
      for (const order of fiveCardDrawEngine.settle(cursor)) {
        const slot = cursor.players.find((p) => p.id === order.playerId);
        if (!slot) continue;
        const credit = slot.totalBet + order.delta;
        if (credit <= 0) continue;
        const u = userMap.get(slot.id);
        if (!u) continue;
        await recordMoneyTransaction(
          {
            userId: u.id,
            type: 'credit',
            amount: credit,
            gamePlayerId: slot.id,
            note: `settle:${order.reason}`,
            idempotencyKey: `settle:${slot.id}`,
          },
          tx,
        );
      }
    }

    cursor = {
      ...cursor,
      turnDeadlineAt: computeTurnDeadline({
        toAct: cursor.toAct,
        isHuman: (slotId) => userMap.get(slotId)?.is_ai === false,
      }),
    };
    finalState = cursor;
    await tx.hand.update({
      where: { id: handId },
      data: { data: cursor as unknown as Prisma.JsonObject },
    });
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handId, ev);
  }
  if (finalState) {
    rearmPokerDeadline(handId, finalState);
  }
}
