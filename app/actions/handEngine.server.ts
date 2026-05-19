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

/**
 * Engine-backed action layer. All game-state transitions flow through
 * `blackjackEngine.applyAction`. Side effects (DB writes, money movements)
 * are scheduled by this wrapper based on the engine's before/after state.
 *
 * Money model: bets are *reserved* (debited) at placement. On terminal
 * settle, the engine emits a net delta; this wrapper credits the player
 * `reserve + delta` (so win returns 2x bet, push returns 1x, lose returns 0).
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
}): Promise<CreateHandResult> {
  if (params.gameType !== 'blackjack') {
    throw new Error(`unsupported game type: ${params.gameType}`);
  }
  const minimumBet = params.minimumBet ?? DEFAULT_MINIMUM_BET;
  const maximumBet = params.maximumBet ?? DEFAULT_MAXIMUM_BET;
  const numDecks = params.numDecks ?? 1;
  const dealerHitsSoft17 = params.dealerHitsSoft17 ?? false;

  const pendingBroadcasts: BroadcastedHandEvent[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const table = await tx.casino_table.create({
      data: {
        game_type: params.gameType,
        minimum_bet: minimumBet,
        maximum_bet: maximumBet,
        max_seats: 1,
        created_by: params.user.id,
      },
    });

    const seat = await tx.seat.create({
      data: {
        table_id: table.id,
        user_id: params.user.id,
        position: 1,
      },
    });

    // Pre-allocate UUIDs so the engine's player id == hand_seat.id.
    const handId = randomUUID();
    const handSeatId = randomUUID();

    const initialState = blackjackEngine.initialState(
      { minimumBet, maximumBet, numDecks, dealerHitsSoft17 },
      [handSeatId],
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
        id: handSeatId,
        hand_id: handId,
        seat_id: seat.id,
        user_id: params.user.id,
        data: { cards: [] } as unknown as Prisma.JsonObject,
      },
    });

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

    return { handId, handSeatId, tableId: table.id, seatId: seat.id };
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
 *  - applies the action via `engine.applyAction`,
 *  - auto-advances the dealer phase if the next state is `dealer`,
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

    // Apply the action.
    const stateAfterPlayer = blackjackEngine.applyAction(
      prevState,
      (actionToApply as { playerId?: string }).playerId ?? params.handSeatId,
      actionToApply,
      defaultRng,
    );

    // Record the player's action as an event in the same transaction.
    // `actor_id` always references the real hand_seat row (the user's
    // primary seat) so the FK stays valid; the payload retains the typed
    // BlackjackAction including the (possibly retargeted) slot id.
    const playerSeq = await appendHandEvent(
      handSeat.hand_id,
      { action: actionToApply.kind, actorId: params.handSeatId, payload: actionToApply },
      tx,
    );
    pendingBroadcasts.push({
      action: actionToApply.kind,
      actor_id: params.handSeatId,
      payload: actionToApply,
      sequence: playerSeq,
      state_after: stateAfterPlayer,
    });

    // After a player action, if all seats are done acting the engine flips
    // to 'dealer'. Run the dealer turn in the same transaction so settle
    // also fires atomically with the player action.
    let nextState = stateAfterPlayer;
    if (nextState.phase === 'dealer') {
      const dealerAction: BlackjackAction = { kind: 'dealer_play' };
      nextState = blackjackEngine.applyAction(nextState, 'dealer', dealerAction, defaultRng);
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
        state_after: nextState,
      });
    }

    // Money: reserve increases + terminal settlement.
    await applyMoneyMoves(prevState, nextState, params.handSeatId, handSeat.user_id, actionToApply, tx);

    // Persist new engine state.
    await tx.hand.update({
      where: { id: handSeat.hand_id },
      data: { data: nextState as unknown as Prisma.JsonObject, updated_at: new Date() },
    });
  });

  // Publish post-commit so subscribers can never see a rolled-back event.
  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handIdForBroadcast, ev);
  }
}

/** Sum the bets across all slots that belong to a single user (including splits). */
function sumReservedFor(state: BlackjackState, handSeatId: string): number {
  return state.players
    .filter((p) => p.id === handSeatId || p.parentSlotId === handSeatId)
    .reduce((s, p) => s + p.bet, 0);
}

/** Slot id → hand_seat id (the parent hand_seat for splits, self otherwise). */
function ownerHandSeatId(state: BlackjackState, slotId: string): string {
  const slot = state.players.find((p) => p.id === slotId);
  return slot?.parentSlotId ?? slotId;
}

async function applyMoneyMoves(
  prev: BlackjackState,
  next: BlackjackState,
  actingHandSeatId: string,
  actingUserId: string,
  action: BlackjackAction,
  tx: PrismaTransactionClient,
): Promise<void> {
  // 1. Reserve any *increase* in total chips committed by the acting user.
  //    Place_bet bumps a single slot's bet from 0; double_down doubles a
  //    slot's bet; split adds a new sibling slot with an equal bet. Summing
  //    bets across all of the user's slots (`id === handSeatId` plus any
  //    `parentSlotId === handSeatId`) lets one diff handle all three.
  const prevReserved = sumReservedFor(prev, actingHandSeatId);
  const nextReserved = sumReservedFor(next, actingHandSeatId);
  if (nextReserved > prevReserved) {
    const noteByAction: Record<string, string> = {
      place_bet: 'reserve:place_bet',
      double_down: 'reserve:double_down',
      split: 'reserve:split',
    };
    await recordMoneyTransaction(
      {
        userId: actingUserId,
        type: 'debit',
        amount: nextReserved - prevReserved,
        gamePlayerId: actingHandSeatId,
        note: noteByAction[action.kind] ?? `reserve:${action.kind}`,
      },
      tx,
    );
  }

  // 2. Reserve insurance the moment the acting player takes it.
  const prevPlayer = prev.players.find((p) => p.id === actingHandSeatId);
  const nextPlayer = next.players.find((p) => p.id === actingHandSeatId);
  if (
    nextPlayer?.insuranceBet &&
    nextPlayer.insuranceBet > 0 &&
    (prevPlayer?.insuranceBet ?? null) === null
  ) {
    await recordMoneyTransaction(
      {
        userId: actingUserId,
        type: 'debit',
        amount: nextPlayer.insuranceBet,
        gamePlayerId: actingHandSeatId,
        note: 'reserve:insurance',
      },
      tx,
    );
  }

  // 3. On terminal transition, credit each slot `reserve + delta`. Split
  //    siblings settle independently but route their credit through the
  //    parent hand_seat (the only one that exists in the DB).
  if (!blackjackEngine.isTerminal(prev) && blackjackEngine.isTerminal(next)) {
    for (const order of blackjackEngine.settle(next)) {
      const player = next.players.find((p) => p.id === order.playerId);
      if (!player) continue;
      const credit = player.bet + order.delta;
      if (credit < 0) {
        throw new Error(`unexpected negative settlement credit ${credit} for ${order.playerId}`);
      }
      if (credit === 0) continue;

      const ledgerHandSeatId = ownerHandSeatId(next, order.playerId);
      const userId = await resolveUserId(ledgerHandSeatId, actingHandSeatId, actingUserId, tx);
      await recordMoneyTransaction(
        {
          userId,
          type: 'credit',
          amount: credit,
          gamePlayerId: ledgerHandSeatId,
          note: `settle:${order.reason}`,
        },
        tx,
      );
    }

    // Insurance settlement. Dealer had natural BJ iff the hand ended with
    // exactly 2 dealer cards totalling 21 (dealer never draws on natural).
    const dealerNaturalBJ = isNaturalBlackjack(next.dealerHand);
    if (dealerNaturalBJ) {
      for (const player of next.players) {
        if (player.insuranceBet && player.insuranceBet > 0) {
          const ledgerHandSeatId = ownerHandSeatId(next, player.id);
          const userId = await resolveUserId(ledgerHandSeatId, actingHandSeatId, actingUserId, tx);
          await recordMoneyTransaction(
            {
              userId,
              type: 'credit',
              amount: 3 * player.insuranceBet,
              gamePlayerId: ledgerHandSeatId,
              note: 'settle:insurance_win',
            },
            tx,
          );
        }
      }
    }
  }
}

async function resolveUserId(
  handSeatId: string,
  actingHandSeatId: string,
  actingUserId: string,
  tx: PrismaTransactionClient,
): Promise<string> {
  if (handSeatId === actingHandSeatId) return actingUserId;
  const seat = await tx.hand_seat.findUnique({
    where: { id: handSeatId },
    select: { user_id: true },
  });
  if (!seat) throw new Error(`could not resolve user for hand_seat ${handSeatId}`);
  return seat.user_id;
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
