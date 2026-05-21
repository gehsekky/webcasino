import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { holdemEngine } from 'engines/poker/holdem/engine';
import type { HoldemAction, HoldemState } from 'engines/poker/holdem/types';
import { HoldemStateSchema } from 'engines/poker/holdem/state.schema';
import { defaultRng } from 'engines/rng';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
import {
  computeTurnDeadline,
  handAdvisoryLockKey,
  turnDeadlineService,
} from 'lib/turnDeadlineService.server';
import type { HandParticipant } from './handEngine.server';

/**
 * Texas Hold'em wrapper. Same shape as `pokerEngine.server.ts` (5-card
 * draw): consume a resolved participant list from `tableLifecycle`, run
 * the AI cascade between human actions, apply per-player chip diffs
 * against `user.money`.
 *
 * Money model:
 *   At hand start each player's stack is read from `user.money`. The
 *   engine debits blinds. The wrapper records every increase in
 *   `player.totalBet` as a debit. At showdown `engine.settle()` returns
 *   one SettlementOrder per slot with `delta = winnings - totalBet`; the
 *   wrapper credits each user `totalBet + delta = winnings`.
 */

export type HoldemRoomConfig = {
  smallBlind: number;
  bigBlind: number;
  /** Wallet → buy-in cap. */
  minimumBuyIn: number;
  maximumBuyIn: number;
};

export async function startHoldemHand(params: {
  roomId: string;
  participants: HandParticipant[];
  config: HoldemRoomConfig;
  creatorId: string;
  /**
   * Seat index of the dealer button for this hand. Lifecycle layer
   * computes this from the previous Hold'em hand's `dealerIdx + 1`
   * (mod numPlayers). Defaults to 0 for the first hand at the room.
   */
  dealerIdx?: number;
}): Promise<{ handId: string }> {
  if (params.participants.length < 2) {
    throw new Error('startHoldemHand: holdem needs at least 2 participants');
  }
  const cfg = params.config;

  const userIds = params.participants.map((p) => p.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, money: true, is_ai: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let finalInitialState: HoldemState | null = null;
  let resultHandId = '';

  const result = await prisma.$transaction(async (tx) => {
    const handId = randomUUID();
    resultHandId = handId;
    const handSeatIds = params.participants.map(() => randomUUID());
    const playerIds = handSeatIds;

    const stacks: Record<string, number> = {};
    const slotIsAi = new Map<string, boolean>();
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      const u = userById.get(p.userId);
      if (!u) throw new Error(`startHoldemHand: user ${p.userId} not found`);
      const buyIn = u.is_ai ? cfg.maximumBuyIn : Math.min(u.money, cfg.maximumBuyIn);
      stacks[handSeatIds[i]] = buyIn;
      slotIsAi.set(handSeatIds[i], u.is_ai);
    }

    let initialState = holdemEngine.initialState(
      {
        smallBlind: cfg.smallBlind,
        bigBlind: cfg.bigBlind,
        stacks,
        dealerIdx: params.dealerIdx,
      },
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
          seat_id: p.seatId,
          user_id: p.userId,
          data: {} as unknown as Prisma.JsonObject,
        },
      });
    }

    // Blinds: walk the participants and debit whatever the engine actually
    // took for that seat (handles short stacks gracefully).
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      const debit = initialState.players[i].totalBet;
      if (debit > 0) {
        await recordMoneyTransaction(
          {
            userId: p.userId,
            type: 'debit',
            amount: debit,
            gamePlayerId: handSeatIds[i],
            note: 'reserve:blind',
          },
          tx,
        );
      }
    }

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

    // If first-to-act after blinds is an AI seat, cascade in this tx
    // until control lands on a human (or the hand goes terminal). Without
    // this, an all-AI prefix in the action order would deadlock the table
    // since AI seats have no turn-timeout to kick them.
    const userMap = new Map<string, { id: string; is_ai: boolean }>(
      handSeatIds.map((slotId, i) => {
        const u = userById.get(params.participants[i].userId)!;
        return [slotId, { id: u.id, is_ai: u.is_ai }];
      }),
    );
    const isAI = (slotId: string) => userMap.get(slotId)?.is_ai === true;
    let cursor: HoldemState = initialState;
    while (!holdemEngine.isTerminal(cursor) && cursor.toAct !== null && isAI(cursor.toAct)) {
      const acting = cursor.toAct;
      const before = cursor;
      const aiAction = holdemEngine.aiAction!(cursor, acting, defaultRng);
      cursor = holdemEngine.applyAction(cursor, acting, aiAction, defaultRng);
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
    if (holdemEngine.isTerminal(cursor)) {
      for (const order of holdemEngine.settle(cursor)) {
        const slot = cursor.players.find((p) => p.id === order.playerId);
        if (!slot) continue;
        const credit = slot.totalBet + order.delta;
        if (credit <= 0) continue;
        const u = userMap.get(slot.id);
        if (!u) throw new Error(`startHoldemHand: unknown owner for slot ${slot.id}`);
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
    rearmHoldemDeadline(resultHandId, finalInitialState);
  }
  return result;
}

export async function submitHoldemAction(params: {
  handSeatId: string;
  action: HoldemAction;
}): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let handIdForBroadcast = '';
  let finalState: HoldemState | null = null;

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true, user: true },
    });
    if (!handSeat) {
      throw new Error('holdemEngine: hand_seat not found');
    }
    handIdForBroadcast = handSeat.hand_id;

    await acquireHoldemHandLock(tx, handSeat.hand_id);

    let state = parseState(handSeat.hand.data);
    if (state.toAct !== params.handSeatId) {
      throw new Error('holdemEngine: not your turn');
    }

    const userMap = await buildUserMap(
      tx,
      state.players.map((p) => p.id),
    );

    // 1. Human action.
    const beforeHuman = state;
    state = holdemEngine.applyAction(state, params.handSeatId, params.action, defaultRng);
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

    // 2. AI cascade.
    const isAI = (slotId: string) => userMap.get(slotId)?.is_ai === true;
    let cursor = state;
    while (!holdemEngine.isTerminal(cursor) && cursor.toAct !== null && isAI(cursor.toAct)) {
      const acting = cursor.toAct;
      const beforeAI = cursor;
      const aiAction = holdemEngine.aiAction!(cursor, acting, defaultRng);
      cursor = holdemEngine.applyAction(cursor, acting, aiAction, defaultRng);
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

    // 3. Settle if terminal.
    if (holdemEngine.isTerminal(state)) {
      for (const order of holdemEngine.settle(state)) {
        const slot = state.players.find((p) => p.id === order.playerId);
        if (!slot) continue;
        const credit = slot.totalBet + order.delta;
        if (credit <= 0) continue;
        const u = userMap.get(slot.id);
        if (!u) throw new Error(`holdemEngine: unknown owner for slot ${slot.id}`);
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
    rearmHoldemDeadline(handIdForBroadcast, finalState);
  }
}

async function applyDiffs(
  prev: HoldemState,
  next: HoldemState,
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
      if (!u) throw new Error(`holdemEngine: unknown owner for slot ${nextSlot.id}`);
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

function parseState(raw: unknown): HoldemState {
  return HoldemStateSchema.parse(raw) as HoldemState;
}

/**
 * Form-submit value → typed HoldemAction. Mirrors `parsePokerActionFromForm`
 * minus the `discard` case (Hold'em has no draw).
 */
export function parseHoldemActionFromForm(
  submitValue: string,
  formData: FormData,
  handSeatId: string,
): HoldemAction {
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
    default:
      throw new Error(`unknown holdem submit value: ${submitValue}`);
  }
}

async function acquireHoldemHandLock(tx: PrismaTransactionClient, handId: string): Promise<void> {
  const key = handAdvisoryLockKey(handId);
  // $executeRawUnsafe — the function returns void; $queryRaw* fails on void.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${key.toString()})`);
}

function rearmHoldemDeadline(handId: string, state: HoldemState): void {
  const deadline = state.turnDeadlineAt;
  if (!deadline) {
    turnDeadlineService.cancel(handId);
    return;
  }
  turnDeadlineService.arm(handId, new Date(deadline), () => fireHoldemTurnTimeout(handId));
}

/**
 * Server-side timeout handler for Texas Hold'em. Engine's aiAction is
 * the passive "check or fold" pick.
 */
export async function fireHoldemTurnTimeout(handId: string): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let finalState: HoldemState | null = null;

  await prisma.$transaction(async (tx) => {
    await acquireHoldemHandLock(tx, handId);
    const hand = await tx.hand.findUnique({
      where: { id: handId },
      include: { casino_table: { select: { created_by: true } } },
    });
    if (!hand) return;
    const state = parseState(hand.data);
    if (state.toAct === null || !state.turnDeadlineAt) return;
    if (Date.now() < new Date(state.turnDeadlineAt).getTime()) {
      finalState = state;
      return;
    }
    const userMap = await buildUserMap(
      tx,
      state.players.map((p) => p.id),
    );
    if (userMap.get(state.toAct)?.is_ai !== false) return;

    const acting = state.toAct;
    // Hold'em timeouts always fold. The engine.aiAction picker is for
    // bots making intentional plays; humans who walk away should
    // forfeit the hand outright.
    const auto: HoldemAction = { kind: 'fold', playerId: acting };
    let cursor = holdemEngine.applyAction(state, acting, auto, defaultRng);
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

    // Move the timed-out player into sit-out for subsequent hands.
    // hand_seat.seat_id is non-null for humans (AI fills are null, but
    // we already short-circuited above on is_ai !== false).
    //
    // Exception: never sit out the room creator — only the creator can
    // start the next hand, so parking them creates a workflow where
    // every hand they start excludes them and they have to rejoin
    // separately. They still auto-fold this hand, just stay in rotation.
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

    const isAI = (slotId: string) => userMap.get(slotId)?.is_ai === true;
    while (!holdemEngine.isTerminal(cursor) && cursor.toAct !== null && isAI(cursor.toAct)) {
      const aiActing = cursor.toAct;
      const before = cursor;
      const aiAction = holdemEngine.aiAction!(cursor, aiActing, defaultRng);
      cursor = holdemEngine.applyAction(cursor, aiActing, aiAction, defaultRng);
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

    if (holdemEngine.isTerminal(cursor)) {
      for (const order of holdemEngine.settle(cursor)) {
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
    rearmHoldemDeadline(handId, finalState);
  }
}
