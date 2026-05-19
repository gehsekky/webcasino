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
 *  - persists the new state and syncs `hand_seat.data.cards`,
 *  - writes audit rows (`hand_seat_bet`, `hand_seat_round`) for current
 *    components; the upcoming event log (task #9) will subsume these.
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

    // Turn / legality enforcement. `place_bet` has variable amount so it's
    // validated inside the engine (amount bounds + status check).
    if (params.action.kind !== 'place_bet') {
      const legal = blackjackEngine.legalActions(prevState, params.handSeatId);
      const isLegal = legal.some((a) => a.kind === params.action.kind);
      if (!isLegal) {
        throw new Error(`action '${params.action.kind}' is not currently legal for this seat`);
      }
    }

    // Apply the action.
    const stateAfterPlayer = blackjackEngine.applyAction(prevState, params.handSeatId, params.action, defaultRng);

    // Record the player's action as an event in the same transaction.
    const playerSeq = await appendHandEvent(
      handSeat.hand_id,
      { action: params.action.kind, actorId: params.handSeatId, payload: params.action },
      tx,
    );
    pendingBroadcasts.push({
      action: params.action.kind,
      actor_id: params.handSeatId,
      payload: params.action,
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
    await applyMoneyMoves(prevState, nextState, params.handSeatId, handSeat.user_id, tx);

    // Persist new engine state.
    await tx.hand.update({
      where: { id: handSeat.hand_id },
      data: { data: nextState as unknown as Prisma.JsonObject, updated_at: new Date() },
    });

    // Denormalize per-player cards for the current UI's read path.
    for (const player of nextState.players) {
      await tx.hand_seat.update({
        where: { id: player.id },
        data: { data: { cards: player.cards } as unknown as Prisma.JsonObject },
      });
    }

    // Audit-trail compat (hand_seat_bet, hand_seat_round). Replaced by the
    // event log in task #9.
    await writeAuditTrail(prevState, nextState, params.handSeatId, params.action, tx);
  });

  // Publish post-commit so subscribers can never see a rolled-back event.
  for (const ev of pendingBroadcasts) {
    broadcastBus.publish(handIdForBroadcast, ev);
  }
}

async function applyMoneyMoves(
  prev: BlackjackState,
  next: BlackjackState,
  actingHandSeatId: string,
  actingUserId: string,
  tx: PrismaTransactionClient,
): Promise<void> {
  const prevPlayer = prev.players.find((p) => p.id === actingHandSeatId);
  const nextPlayer = next.players.find((p) => p.id === actingHandSeatId);

  // 1. Reserve any increase in the acting player's main bet (place_bet,
  //    double_down). Atomic UPDATE rejects insufficient funds.
  const prevBet = prevPlayer?.bet ?? 0;
  const nextBet = nextPlayer?.bet ?? 0;
  if (nextBet > prevBet) {
    const isFirstBet = prevBet === 0;
    await recordMoneyTransaction(
      {
        userId: actingUserId,
        type: 'debit',
        amount: nextBet - prevBet,
        gamePlayerId: actingHandSeatId,
        note: isFirstBet ? 'reserve:place_bet' : 'reserve:double_down',
      },
      tx,
    );
  }

  // 2. Reserve insurance the moment the acting player takes it.
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

  // 3. On terminal transition, credit each player `reserve + delta` on the
  //    main bet, then credit insurance winners 3× their insurance bet.
  if (!blackjackEngine.isTerminal(prev) && blackjackEngine.isTerminal(next)) {
    for (const order of blackjackEngine.settle(next)) {
      const player = next.players.find((p) => p.id === order.playerId);
      if (!player) continue;
      const credit = player.bet + order.delta;
      if (credit < 0) {
        throw new Error(`unexpected negative settlement credit ${credit} for ${order.playerId}`);
      }
      if (credit === 0) continue;

      const userId = await resolveUserId(order.playerId, actingHandSeatId, actingUserId, tx);
      await recordMoneyTransaction(
        {
          userId,
          type: 'credit',
          amount: credit,
          gamePlayerId: order.playerId,
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
          const userId = await resolveUserId(player.id, actingHandSeatId, actingUserId, tx);
          await recordMoneyTransaction(
            {
              userId,
              type: 'credit',
              // 2:1 payout returns 3× the wager (reserve + 2× winnings).
              amount: 3 * player.insuranceBet,
              gamePlayerId: player.id,
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

async function writeAuditTrail(
  prev: BlackjackState,
  next: BlackjackState,
  handSeatId: string,
  action: BlackjackAction,
  tx: PrismaTransactionClient,
): Promise<void> {
  // place_bet → audit as a hand_seat_bet row of type 'initial'.
  if (action.kind === 'place_bet') {
    await tx.hand_seat_bet.create({
      data: {
        hand_seat_id: handSeatId,
        amount: action.amount,
        type: 'initial',
      },
    });
  }

  // Player actions → hand_seat_round row.
  const auditAction = (() => {
    switch (action.kind) {
      case 'hit':
        return 'hit';
      case 'stay':
        return 'stay';
      case 'double_down':
        return 'double down';
      case 'surrender':
        return 'surrender';
      default:
        return null;
    }
  })();
  if (auditAction) {
    const rounds = await tx.hand_seat_round.findMany({
      where: { hand_seat_id: handSeatId },
      orderBy: { round: 'desc' },
      take: 1,
    });
    const next = (rounds[0]?.round ?? 0) + 1;
    await tx.hand_seat_round.create({
      data: { hand_seat_id: handSeatId, round: next, action: auditAction },
    });
  }

  // Terminal transition → write final win/lose/push round per player.
  if (!blackjackEngine.isTerminal(prev) && blackjackEngine.isTerminal(next)) {
    for (const player of next.players) {
      const finalAction = (() => {
        switch (player.status) {
          case 'won':
          case 'blackjack':
            return 'win';
          case 'lost':
          case 'busted':
            return 'lose';
          case 'pushed':
            return 'push';
          case 'surrendered':
            return 'lose';
          default:
            return null;
        }
      })();
      if (!finalAction) continue;

      const rounds = await tx.hand_seat_round.findMany({
        where: { hand_seat_id: player.id },
        orderBy: { round: 'desc' },
        take: 1,
      });
      const nextRound = (rounds[0]?.round ?? 0) + 1;
      await tx.hand_seat_round.create({
        data: { hand_seat_id: player.id, round: nextRound, action: finalAction },
      });
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
    case 'surrender':
      return { kind: 'surrender', playerId: handSeatId };
    default:
      throw new Error(`unknown submit value: ${submitValue}`);
  }
}
