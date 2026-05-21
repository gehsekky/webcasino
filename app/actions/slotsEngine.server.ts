import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { recordMoneyTransaction } from './moneyTransaction.server';
import { slotsEngine } from 'engines/slots/engine';
import type { SlotsAction, SlotsState } from 'engines/slots/types';
import { SlotsStateSchema } from 'engines/slots/state.schema';
import { defaultRng } from 'engines/rng';
import { appendHandEvent, HAND_INITIALIZED } from 'lib/handEvents';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
import { handAdvisoryLockKey } from 'lib/turnDeadlineService.server';
import type { HandParticipant } from './handEngine.server';

/**
 * Slots wrapper. Single-seat single-spin hand: provision the state, then
 * `submitSlotsAction` does the spin + settle + money debit/credit.
 *
 * Money model:
 *   On `spin`, the wrapper debits the bet amount from the user.
 *   Engine settles immediately with `delta = winnings - stake`.
 *   Wrapper credits each user `stake + delta = winnings`.
 */

export type SlotsRoomConfig = {
  minimumBet: number;
  maximumBet: number;
};

export async function startSlotsHand(params: {
  roomId: string;
  participants: HandParticipant[];
  config: SlotsRoomConfig;
  creatorId: string;
}): Promise<{ handId: string }> {
  if (params.participants.length !== 1) {
    throw new Error('startSlotsHand: slots is a single-seat game');
  }
  const cfg = params.config;
  const pendingBroadcasts: BroadcastedHandEvent[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const handId = randomUUID();
    const handSeatIds = params.participants.map(() => randomUUID());

    const initialState = slotsEngine.initialState(
      { minimumBet: cfg.minimumBet, maximumBet: cfg.maximumBet },
      handSeatIds,
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

export async function submitSlotsAction(params: {
  handSeatId: string;
  action: SlotsAction;
}): Promise<void> {
  const pendingBroadcasts: BroadcastedHandEvent[] = [];
  let handIdForBroadcast = '';

  await prisma.$transaction(async (tx) => {
    const handSeat = await tx.hand_seat.findUnique({
      where: { id: params.handSeatId },
      include: { hand: true },
    });
    if (!handSeat) throw new Error('slotsEngine: hand_seat not found');
    handIdForBroadcast = handSeat.hand_id;

    // Per-hand advisory lock + re-read so concurrent spin submissions
    // serialize cleanly — same pattern as the other engines. Slots is
    // single-seat so the practical impact is "user double-clicks the
    // spin button," but the protection is uniform with the rest.
    await acquireSlotsHandLock(tx, handSeat.hand_id);
    const fresh = await tx.hand.findUnique({
      where: { id: handSeat.hand_id },
      select: { data: true },
    });
    if (!fresh) throw new Error('slotsEngine: hand vanished mid-action');
    let state = parseState(fresh.data);
    if (state.toAct !== params.handSeatId) {
      throw new Error('slotsEngine: not your turn');
    }

    // Debit the stake before spinning so an insufficient-funds user fails
    // here rather than after the spin reveals.
    await recordMoneyTransaction(
      {
        userId: handSeat.user_id,
        type: 'debit',
        amount: params.action.amount,
        gamePlayerId: params.handSeatId,
        note: 'reserve:spin',
      },
      tx,
    );

    state = slotsEngine.applyAction(state, params.handSeatId, params.action, defaultRng);

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

    // Settle — credit winnings if any.
    const winnings = state.players[0].winnings;
    if (winnings > 0) {
      await recordMoneyTransaction(
        {
          userId: handSeat.user_id,
          type: 'credit',
          amount: winnings,
          gamePlayerId: params.handSeatId,
          note: `settle:${state.players[0].payoutKind ?? 'win'}`,
        },
        tx,
      );
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

function parseState(raw: unknown): SlotsState {
  return SlotsStateSchema.parse(raw) as SlotsState;
}

/** Per-hand tx-scoped advisory lock, same pattern as the other engines. */
async function acquireSlotsHandLock(tx: PrismaTransactionClient, handId: string): Promise<void> {
  const key = handAdvisoryLockKey(handId);
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${key.toString()})`);
}

export function parseSlotsActionFromForm(
  submitValue: string,
  formData: FormData,
  handSeatId: string,
): SlotsAction {
  if (submitValue !== 'spin') {
    throw new Error(`unknown slots submit value: ${submitValue}`);
  }
  const raw = formData.get('amount')?.toString() ?? '';
  const amount = parseInt(raw, 10);
  if (!Number.isFinite(amount)) throw new Error('invalid spin amount');
  return { kind: 'spin', playerId: handSeatId, amount };
}
