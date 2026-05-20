import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { holdemEngine } from 'engines/poker/holdem/engine';
import type { HoldemAction, HoldemState } from 'engines/poker/holdem/types';
import { defaultRng } from 'engines/rng';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
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

  const result = await prisma.$transaction(async (tx) => {
    const handId = randomUUID();
    const handSeatIds = params.participants.map(() => randomUUID());
    const playerIds = handSeatIds;

    const stacks: Record<string, number> = {};
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      const u = userById.get(p.userId);
      if (!u) throw new Error(`startHoldemHand: user ${p.userId} not found`);
      const buyIn = u.is_ai ? cfg.maximumBuyIn : Math.min(u.money, cfg.maximumBuyIn);
      stacks[handSeatIds[i]] = buyIn;
    }

    const initialState = holdemEngine.initialState(
      { smallBlind: cfg.smallBlind, bigBlind: cfg.bigBlind, stacks },
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

    return { handId };
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(result.handId, ev);
  }
  return result;
}

export async function submitHoldemAction(params: {
  handSeatId: string;
  action: HoldemAction;
}): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let handIdForBroadcast = '';

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true, user: true },
    });
    if (!handSeat) {
      throw new Error('holdemEngine: hand_seat not found');
    }
    handIdForBroadcast = handSeat.hand_id;

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
          },
          tx,
        );
      }
    }

    // 4. Persist.
    await tx.hand.update({
      where: { id: handSeat.hand_id },
      data: { data: state as unknown as Prisma.JsonObject },
    });
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handIdForBroadcast, ev);
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
  if (!raw || typeof raw !== 'object' || (raw as { type?: string }).type !== 'holdem') {
    throw new Error('holdemEngine: hand.data does not look like a holdem state');
  }
  return raw as HoldemState;
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
