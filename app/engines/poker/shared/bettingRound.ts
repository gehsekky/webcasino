/**
 * Generic betting-round state machine shared between 5-card draw and
 * Texas Hold'em. The shape is intentionally minimal — engines hold their
 * own per-hand state (cards, phase, button, etc.) and call into this
 * module to apply one actor's betting decision.
 *
 * Vocabulary:
 *   currentBet  — the amount each remaining actor must match to stay in
 *                 the round (0 = no one has bet yet → checks are legal).
 *   bet         — like an opening raise from 0. Same data shape as raise.
 *   call        — match `currentBet` (subtract from chips).
 *   raise       — increase `currentBet` to a higher amount.
 *   fold        — leave the hand; chips already in stay in the pot.
 *   minRaise    — the minimum legal raise increment (often = last raise).
 *
 * Side pots are NOT modeled here — they live in `pot.ts` and are
 * reconstructed at showdown from the per-actor contribution totals.
 */

import type { CardData } from 'lib/gameState';

export type ActorStatus = 'active' | 'folded' | 'all_in';

export type BettingActor = {
  /** Stable id (usually hand_seat.id or a virtual split-style id). */
  id: string;
  status: ActorStatus;
  /** Chips remaining in the actor's stack. */
  chips: number;
  /** Amount the actor has contributed this round. */
  currentBet: number;
  /** Total contributed across all rounds this hand (for side-pot math). */
  totalBet: number;
};

export type BettingActionKind = 'check' | 'call' | 'bet' | 'raise' | 'fold';

export type BettingAction =
  | { kind: 'check' }
  | { kind: 'call' }
  | { kind: 'bet'; amount: number }
  | { kind: 'raise'; amount: number }
  | { kind: 'fold' };

export type RoundState = {
  /** Actors in seating order. */
  actors: BettingActor[];
  /** Highest bet anyone has placed this round. 0 if no one has bet. */
  currentBet: number;
  /** Minimum legal next raise size. Re-raise must be at least this big above currentBet. */
  minRaise: number;
  /** Index into `actors` for whose turn it is. -1 when round complete. */
  toActIdx: number;
  /**
   * Index of the last actor whose bet/raise *opened the action* — the
   * round closes when action comes back around to them and no further
   * raise was made. -1 if no aggressor yet this round (everyone checked
   * or only calls so far).
   */
  lastAggressorIdx: number;
  /** True when all remaining active actors have either matched or folded. */
  complete: boolean;
};

/**
 * Build a fresh round state with all actors marked active (or all_in if
 * stack is 0). Caller seeds `chips`, `currentBet=0`, `totalBet` from
 * carryover, and picks who starts (`startingActorIdx`).
 *
 * For non-zero opening `currentBet` (e.g. blinds in Hold'em pre-flop):
 * pass `currentBet` and `minRaise` explicitly. Actors who've already
 * posted blinds need their `currentBet` set on input.
 */
export function startRound(params: {
  actors: BettingActor[];
  startingActorIdx: number;
  currentBet?: number;
  minRaise?: number;
}): RoundState {
  const actors = params.actors.map((a) => ({ ...a }));
  return {
    actors,
    currentBet: params.currentBet ?? 0,
    minRaise: params.minRaise ?? 1,
    toActIdx: nextActiveFrom(actors, params.startingActorIdx),
    lastAggressorIdx: -1,
    complete: actors.filter((a) => a.status === 'active').length <= 1,
  };
}

/**
 * Apply one actor's betting action and return the new round state. Throws
 * when the action isn't currently legal for `actorId`.
 */
export function applyBettingAction(
  state: RoundState,
  actorId: string,
  action: BettingAction,
): RoundState {
  if (state.complete) {
    throw new Error('betting round is already complete');
  }
  const idx = state.actors.findIndex((a) => a.id === actorId);
  if (idx === -1) {
    throw new Error(`betting round: unknown actor ${actorId}`);
  }
  if (idx !== state.toActIdx) {
    throw new Error(`betting round: not ${actorId}'s turn`);
  }
  const actor = state.actors[idx];
  if (actor.status !== 'active') {
    throw new Error(`betting round: ${actorId} is ${actor.status}`);
  }

  const next: RoundState = {
    ...state,
    actors: state.actors.map((a) => ({ ...a })),
  };
  const a = next.actors[idx];

  switch (action.kind) {
    case 'fold':
      a.status = 'folded';
      break;

    case 'check':
      if (a.currentBet !== state.currentBet) {
        throw new Error('check is illegal — you must match the current bet');
      }
      // No chip movement.
      break;

    case 'call': {
      const owed = state.currentBet - a.currentBet;
      if (owed < 0) {
        throw new Error('call: actor has already over-bet (state corrupt)');
      }
      if (owed === 0) {
        throw new Error('call: nothing to call — use check');
      }
      const pay = Math.min(owed, a.chips);
      a.chips -= pay;
      a.currentBet += pay;
      a.totalBet += pay;
      if (a.chips === 0) {
        a.status = 'all_in';
      }
      break;
    }

    case 'bet':
    case 'raise': {
      if (action.kind === 'bet' && state.currentBet !== 0) {
        throw new Error('bet: already a bet to call — use raise');
      }
      if (action.kind === 'raise' && state.currentBet === 0) {
        throw new Error('raise: nothing to raise — use bet');
      }
      if (!Number.isInteger(action.amount) || action.amount <= 0) {
        throw new Error(`${action.kind}: amount must be a positive integer`);
      }
      const target = action.kind === 'bet' ? action.amount : action.amount;
      // For a raise, target must be at least currentBet + minRaise.
      if (action.kind === 'raise' && target < state.currentBet + state.minRaise) {
        throw new Error(`raise: ${target} below minimum (${state.currentBet + state.minRaise})`);
      }
      const owed = target - a.currentBet;
      if (owed > a.chips) {
        throw new Error(`${action.kind}: insufficient chips (need ${owed}, have ${a.chips})`);
      }
      a.chips -= owed;
      a.currentBet = target;
      a.totalBet += owed;
      next.minRaise = target - state.currentBet;
      next.currentBet = target;
      next.lastAggressorIdx = idx;
      if (a.chips === 0) {
        a.status = 'all_in';
      }
      break;
    }
  }

  // Advance to next actor or close the round.
  next.toActIdx = nextActiveFrom(next.actors, idx + 1);
  if (next.toActIdx === -1) {
    next.complete = true;
  } else {
    // Round closes if action would return to the last aggressor and
    // everyone else has matched.
    const wouldReturnToAggressor = next.toActIdx === next.lastAggressorIdx;
    const everyoneMatched = next.actors.every(
      (a) => a.status !== 'active' || a.currentBet === next.currentBet,
    );
    // Folded-down: only one active left.
    const remainingActive = next.actors.filter((x) => x.status === 'active').length;

    if (remainingActive <= 1) {
      next.complete = true;
      next.toActIdx = -1;
    } else if (next.lastAggressorIdx === -1 && everyoneMatched) {
      // No bet placed this round and we've made a full lap of checks.
      // Check if every active actor has had a turn (currentBet stays 0).
      next.complete = haveAllActiveActed(next, next.toActIdx);
      if (next.complete) next.toActIdx = -1;
    } else if (wouldReturnToAggressor && everyoneMatched) {
      next.complete = true;
      next.toActIdx = -1;
    }
  }
  return next;
}

/**
 * Find the index of the next active actor starting at `from` (wrapping
 * around the array). Returns -1 if none.
 */
function nextActiveFrom(actors: BettingActor[], from: number): number {
  const n = actors.length;
  for (let step = 0; step < n; step++) {
    const i = (from + step) % n;
    if (actors[i].status === 'active') return i;
  }
  return -1;
}

/**
 * Determine whether every still-active actor has had at least one turn
 * this round, used to close a no-bet round after a full lap of checks.
 *
 * We approximate this by checking whether the next-to-act index equals
 * the starting actor of the round. Since we don't store `startingActor`
 * explicitly, we use the invariant: if there are still active actors
 * with `currentBet === 0` and no bet has been placed, the round is open.
 * Once everyone has effectively "checked" the round closes.
 *
 * To keep this self-contained without tracking start position, we use a
 * simpler heuristic: if nextActiveFrom wraps and the next actor is the
 * acting one we just advanced past, we've made a full lap.
 */
function haveAllActiveActed(state: RoundState, nextIdx: number): boolean {
  // After a check from `idx`, nextActiveFrom(idx + 1) tells us the next
  // active seat. If that next seat is the FIRST active seat (i.e., we've
  // gone all the way around), the lap is complete.
  const firstActive = nextActiveFrom(state.actors, 0);
  return nextIdx === firstActive;
}

/** True iff exactly one actor still has the `active` status. */
export function isFoldedDown(state: RoundState): boolean {
  return state.actors.filter((a) => a.status === 'active').length === 1;
}

/** Helper for engines: legal actions for the actor whose turn it is. */
export function legalActionsFor(state: RoundState, actorId: string): BettingActionKind[] {
  if (state.complete) return [];
  const idx = state.actors.findIndex((a) => a.id === actorId);
  if (idx !== state.toActIdx) return [];
  const a = state.actors[idx];
  if (a.status !== 'active') return [];
  const owed = state.currentBet - a.currentBet;
  const result: BettingActionKind[] = ['fold'];
  if (owed === 0) {
    result.push('check');
    if (a.chips > 0) result.push('bet');
  } else {
    if (a.chips > 0) result.push('call');
    if (a.chips > owed) result.push('raise');
  }
  return result;
}

/** Total chips contributed across all actors this round. */
export function roundPotContribution(state: RoundState): number {
  return state.actors.reduce((sum, a) => sum + a.currentBet, 0);
}

/** Re-export of the per-card type the rest of the poker code uses. */
export type { CardData };
