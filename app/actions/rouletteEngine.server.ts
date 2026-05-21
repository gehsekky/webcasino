import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { rouletteEngine } from 'engines/roulette/engine';
import type { RouletteAction, RouletteState } from 'engines/roulette/types';
import { RouletteStateSchema } from 'engines/roulette/state.schema';
import { defaultRng } from 'engines/rng';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
import { handAdvisoryLockKey } from 'lib/turnDeadlineService.server';
import type { HandParticipant } from './handEngine.server';

/**
 * Roulette wrapper. Multi-seat: every player places their own bets, then
 * the room creator (enforced upstream in the route action) submits a
 * `spin` action which atomically resolves all bets and settles.
 *
 * Money model:
 *   `place_bet` debits the bet amount immediately. `spin` settles: for
 *   each player, `delta = winnings - totalStake`. Wrapper credits each
 *   user `totalStake + delta = winnings` so won bets return both stake
 *   and prize.
 */

export type RouletteRoomConfig = {
  minimumBet: number;
  maximumBet: number;
};

export async function startRouletteHand(params: {
  roomId: string;
  participants: HandParticipant[];
  config: RouletteRoomConfig;
  creatorId: string;
}): Promise<{ handId: string }> {
  if (params.participants.length < 1) {
    throw new Error('startRouletteHand: at least one participant required');
  }
  const cfg = params.config;

  // We need to know which participants are AI ahead of time so we can
  // pre-populate their bets in the initial state. Look up `is_ai` once.
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

    let state = rouletteEngine.initialState(
      { minimumBet: cfg.minimumBet, maximumBet: cfg.maximumBet },
      handSeatIds,
      defaultRng,
    );

    // AI participants place 1-3 random bets up front. Humans place
    // theirs interactively via submitRouletteAction. The engine's
    // aiAction picks a bet kind (70% outside / 30% straight) and an
    // amount within the table's range.
    for (let i = 0; i < params.participants.length; i++) {
      const p = params.participants[i];
      if (!isAiByUserId.get(p.userId)) continue;
      const slotId = handSeatIds[i];
      const numBets = 1 + defaultRng.randInt(3); // 1, 2, or 3
      for (let b = 0; b < numBets; b++) {
        const action = rouletteEngine.aiAction!(state, slotId, defaultRng);
        state = rouletteEngine.applyAction(state, slotId, action, defaultRng);
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

    // Debit AI users for the bets they just placed. Humans get debited
    // later via the per-action diff in submitRouletteAction, so any slot
    // with totalStake > 0 right now must be AI.
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

export async function submitRouletteAction(params: {
  handSeatId: string;
  action: RouletteAction;
}): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let handIdForBroadcast = '';

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true },
    });
    if (!handSeat) throw new Error('rouletteEngine: hand_seat not found');
    handIdForBroadcast = handSeat.hand_id;

    // Per-hand advisory lock: serializes concurrent place_bet / spin
    // calls so the engine's phase check sees committed state. Without
    // this, a place_bet read under awaiting_bets could overwrite a
    // just-committed spin (or vice versa). Released at tx end.
    await acquireRouletteHandLock(tx, handSeat.hand_id);
    // Re-read hand.data after the lock so we see any committed update
    // from the tx we just serialized behind.
    const fresh = await tx.hand.findUnique({
      where: { id: handSeat.hand_id },
      select: { data: true },
    });
    if (!fresh) throw new Error('rouletteEngine: hand vanished mid-action');
    let state = parseState(fresh.data);
    const userMap = await buildUserMap(
      tx,
      state.players.map((p) => p.id),
    );

    const beforeAction = state;
    state = rouletteEngine.applyAction(state, params.handSeatId, params.action, defaultRng);

    // Money diffs: any increase in a player's totalStake is debited.
    for (const nextSlot of state.players) {
      const prevSlot = beforeAction.players.find((p) => p.id === nextSlot.id);
      const prevStake = prevSlot?.totalStake ?? 0;
      const diff = nextSlot.totalStake - prevStake;
      if (diff > 0) {
        const u = userMap.get(nextSlot.id);
        if (!u) throw new Error(`rouletteEngine: unknown owner for slot ${nextSlot.id}`);
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

    // Settle if terminal.
    if (rouletteEngine.isTerminal(state)) {
      for (const order of rouletteEngine.settle(state)) {
        const slot = state.players.find((p) => p.id === order.playerId);
        if (!slot) continue;
        const credit = slot.totalStake + order.delta;
        if (credit <= 0) continue;
        const u = userMap.get(slot.id);
        if (!u) throw new Error(`rouletteEngine: unknown owner for slot ${slot.id}`);
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

function parseState(raw: unknown): RouletteState {
  return RouletteStateSchema.parse(raw) as RouletteState;
}

/**
 * Form value → typed RouletteAction.
 *   submit: 'place_bet' → reads `betKind`, `amount`, optional `number`
 *   submit: 'spin'      → no params
 */
export function parseRouletteActionFromForm(
  submitValue: string,
  formData: FormData,
  handSeatId: string,
): RouletteAction {
  if (submitValue === 'spin') {
    return { kind: 'spin', playerId: handSeatId };
  }
  if (submitValue === 'place_bet') {
    const betKind = formData.get('betKind')?.toString() ?? '';
    const amountRaw = formData.get('amount')?.toString() ?? '';
    const amount = parseInt(amountRaw, 10);
    if (!Number.isFinite(amount)) throw new Error('invalid bet amount');
    const numberRaw = formData.get('number')?.toString();
    const number = numberRaw ? parseInt(numberRaw, 10) : undefined;
    return {
      kind: 'place_bet',
      playerId: handSeatId,
      bet: { kind: betKind as never, amount, number },
    };
  }
  throw new Error(`unknown roulette submit value: ${submitValue}`);
}

/** Per-hand tx-scoped advisory lock, same pattern as the other engines. */
async function acquireRouletteHandLock(tx: PrismaTransactionClient, handId: string): Promise<void> {
  const key = handAdvisoryLockKey(handId);
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${key.toString()})`);
}
