import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { baccaratEngine } from 'engines/baccarat/engine';
import type { BaccaratAction, BaccaratState } from 'engines/baccarat/types';
import { BaccaratStateSchema } from 'engines/baccarat/state.schema';
import { defaultRng } from 'engines/rng';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
import { handAdvisoryLockKey } from 'lib/turnDeadlineService.server';
import type { HandParticipant } from './handEngine.server';

/**
 * Baccarat (Punto Banco) wrapper. Multi-seat: every player places bets on
 * Player / Banker / Tie, then the room creator submits a `deal` action
 * which resolves the entire hand (including any third-card draws per the
 * tableau) and settles.
 *
 * Money model:
 *   `place_bet` debits the bet amount immediately. `deal` settles: for
 *   each player, `delta = winnings - totalStake`. Wrapper credits each
 *   user `totalStake + delta = winnings` so won + pushed bets return
 *   the right amount.
 */

export type BaccaratRoomConfig = {
  minimumBet: number;
  maximumBet: number;
};

export async function startBaccaratHand(params: {
  roomId: string;
  participants: HandParticipant[];
  config: BaccaratRoomConfig;
  creatorId: string;
}): Promise<{ handId: string }> {
  if (params.participants.length < 1) {
    throw new Error('startBaccaratHand: at least one participant required');
  }
  const cfg = params.config;

  // Look up `is_ai` once so we can pre-populate AI bets in the initial state.
  const userIds = params.participants.map((p) => p.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, is_ai: true },
  });
  const isAiByUserId = new Map(users.map((u) => [u.id, u.is_ai]));

  const pendingBroadcasts: BroadcastedHandEvent[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const handId = randomUUID();
    const handSeatIds = params.participants.map(() => randomUUID());

    let state = baccaratEngine.initialState(
      { minimumBet: cfg.minimumBet, maximumBet: cfg.maximumBet },
      handSeatIds,
      defaultRng,
    );

    // AI participants place 1–3 random bets up front. Humans place
    // theirs interactively via submitBaccaratAction.
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      if (!isAiByUserId.get(p.userId)) continue;
      const slotId = handSeatIds[i];
      const numBets = 1 + defaultRng.randInt(3);
      for (let b = 0; b < numBets; b++) {
        const action = baccaratEngine.aiAction!(state, slotId, defaultRng);
        state = baccaratEngine.applyAction(state, slotId, action, defaultRng);
      }
    }

    await tx.hand.create({
      data: {
        id: handId,
        table_id: params.roomId,
        created_by: params.creatorId,
        data: state as unknown as Prisma.JsonObject,
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

    // Debit AI users for the bets they just placed.
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      const slot = state.players[i];
      if (slot.totalStake > 0) {
        await recordMoneyTransaction(
          {
            userId: p.userId,
            type: 'debit',
            amount: slot.totalStake,
            gamePlayerId: handSeatIds[i],
            note: 'reserve:ai_bets',
          },
          tx,
        );
      }
    }

    const bootSeq = await appendHandEvent(
      handId,
      { action: HAND_INITIALIZED, actorId: null, payload: { initialState: state } },
      tx,
    );
    pendingBroadcasts.push({
      action: HAND_INITIALIZED,
      actor_id: null,
      payload: { initialState: state },
      sequence: bootSeq,
      state_after: state as unknown as never,
    });

    return { handId };
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(result.handId, ev);
  }
  return result;
}

export async function submitBaccaratAction(params: {
  handSeatId: string;
  action: BaccaratAction;
}): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let handIdForBroadcast = '';

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true },
    });
    if (!handSeat) throw new Error('baccaratEngine: hand_seat not found');
    handIdForBroadcast = handSeat.hand_id;

    // Same race protection as roulette: acquire the per-hand lock, then
    // re-read so concurrent place_bet/deal submissions see committed state.
    await acquireBaccaratHandLock(tx, handSeat.hand_id);
    const fresh = await tx.hand.findUnique({
      where: { id: handSeat.hand_id },
      select: { data: true },
    });
    if (!fresh) throw new Error('baccaratEngine: hand vanished mid-action');
    let state = parseState(fresh.data);

    const userMap = await buildUserMap(
      tx,
      state.players.map((p) => p.id),
    );

    const beforeAction = state;
    state = baccaratEngine.applyAction(state, params.handSeatId, params.action, defaultRng);

    // Money diffs: any increase in a player's totalStake is debited.
    for (const nextSlot of state.players) {
      const prevSlot = beforeAction.players.find((p) => p.id === nextSlot.id);
      const prevStake = prevSlot?.totalStake ?? 0;
      const diff = nextSlot.totalStake - prevStake;
      if (diff > 0) {
        const u = userMap.get(nextSlot.id);
        if (!u) throw new Error(`baccaratEngine: unknown owner for slot ${nextSlot.id}`);
        await recordMoneyTransaction(
          {
            userId: u.id,
            type: 'debit',
            amount: diff,
            gamePlayerId: nextSlot.id,
            note: `reserve:${params.action.kind}`,
          },
          tx,
        );
      }
    }

    const seq = await appendHandEvent(
      handSeat.hand_id,
      { action: params.action.kind, actorId: params.handSeatId, payload: params.action },
      tx,
    );
    pendingBroadcasts.push({
      action: params.action.kind,
      actor_id: params.handSeatId,
      payload: params.action,
      sequence: seq,
      state_after: state as unknown as never,
    });

    // Settle if terminal (`deal` always transitions to settled).
    if (baccaratEngine.isTerminal(state)) {
      for (const order of baccaratEngine.settle(state)) {
        const slot = state.players.find((p) => p.id === order.playerId);
        if (!slot) continue;
        const credit = slot.totalStake + order.delta;
        if (credit <= 0) continue;
        const u = userMap.get(slot.id);
        if (!u) throw new Error(`baccaratEngine: unknown owner for slot ${slot.id}`);
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

    await tx.hand.update({
      where: { id: handSeat.hand_id },
      data: { data: state as unknown as Prisma.JsonObject },
    });
  });

  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handIdForBroadcast, ev);
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

function parseState(raw: unknown): BaccaratState {
  return BaccaratStateSchema.parse(raw) as BaccaratState;
}

/**
 * Form value → typed BaccaratAction.
 *   submit: 'place_bet' → reads `betKind` and `amount`
 *   submit: 'deal'      → no params
 */
export function parseBaccaratActionFromForm(
  submitValue: string,
  formData: FormData,
  handSeatId: string,
): BaccaratAction {
  if (submitValue === 'deal') {
    return { kind: 'deal', playerId: handSeatId };
  }
  if (submitValue === 'place_bet') {
    const betKind = formData.get('betKind')?.toString() ?? '';
    if (betKind !== 'player' && betKind !== 'banker' && betKind !== 'tie') {
      throw new Error(`invalid baccarat bet kind: ${betKind}`);
    }
    const amountRaw = formData.get('amount')?.toString() ?? '';
    const amount = parseInt(amountRaw, 10);
    if (!Number.isFinite(amount)) throw new Error('invalid bet amount');
    return {
      kind: 'place_bet',
      playerId: handSeatId,
      bet: { kind: betKind, amount },
    };
  }
  throw new Error(`unknown baccarat submit value: ${submitValue}`);
}

async function acquireBaccaratHandLock(tx: PrismaTransactionClient, handId: string): Promise<void> {
  const key = handAdvisoryLockKey(handId);
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${key.toString()})`);
}
