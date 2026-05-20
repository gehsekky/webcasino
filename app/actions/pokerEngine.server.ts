import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { fiveCardDrawEngine } from 'engines/poker/fiveCardDraw/engine';
import type { FiveCardDrawAction, FiveCardDrawState } from 'engines/poker/fiveCardDraw/types';
import { defaultRng } from 'engines/rng';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
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

  const result = await prisma.$transaction(async (tx) => {
    const handId = randomUUID();
    const handSeatIds = params.participants.map(() => randomUUID());
    const playerIds = handSeatIds;

    // Stacks per participant in position order.
    const stacks: Record<string, number> = {};
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      const u = userById.get(p.userId);
      if (!u) throw new Error(`startPokerHand: user ${p.userId} not found`);
      const buyIn = u.is_ai ? cfg.maximumBuyIn : Math.min(u.money, cfg.maximumBuyIn);
      stacks[handSeatIds[i]] = buyIn;
    }

    const initialState = fiveCardDrawEngine.initialState(
      { ante: cfg.ante, minBet: cfg.minBet, stacks },
      playerIds,
      defaultRng,
    );

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

    return { handId };
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(result.handId, ev);
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

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true, user: true },
    });
    if (!handSeat) {
      throw new Error('pokerEngine: hand_seat not found');
    }
    handIdForBroadcast = handSeat.hand_id;

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
          },
          tx,
        );
      }
    }

    // 4. Persist new engine state.
    await tx.hand.update({
      where: { id: handSeat.hand_id },
      data: { data: state as unknown as Prisma.JsonObject },
    });
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handIdForBroadcast, ev);
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
  // No Zod schema yet for the poker engine state; trust the engine
  // wrote it, and the type is internally consistent.
  if (!raw || typeof raw !== 'object' || (raw as { type?: string }).type !== 'fivecarddraw') {
    throw new Error('pokerEngine: hand.data does not look like a fivecarddraw state');
  }
  return raw as FiveCardDrawState;
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
