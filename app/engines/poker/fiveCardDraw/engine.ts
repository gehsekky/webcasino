import type { GameEngine, RNG, SettlementOrder } from '../../types';
import type { CardData, Suit, Rank } from 'lib/gameState';
import { evaluateHand } from '../shared/handEval';
import { buildPots, distributePots } from '../shared/pot';
import { CATEGORY_VALUE, cardValue, compareHandRanks } from '../shared/types';
import type {
  FiveCardDrawAction,
  FiveCardDrawConfig,
  FiveCardDrawState,
  FiveCardDrawView,
  PlayerSlot,
} from './types';

const SUITS: Suit[] = ['hearts', 'spades', 'clubs', 'diamonds'];
const RANKS: Rank[] = [
  'Ace',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'Jack',
  'Queen',
  'King',
];

function freshDeck(): CardData[] {
  const cards: CardData[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ suit, rank });
    }
  }
  return cards;
}

function shuffle(deck: CardData[], rng: RNG): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.randInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function draw(deck: CardData[]): CardData {
  const c = deck.pop();
  if (!c) throw new Error('5cd: deck empty');
  return c;
}

function findPlayer(state: FiveCardDrawState, id: string): PlayerSlot {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`5cd: unknown player ${id}`);
  return p;
}

function deepClone(state: FiveCardDrawState): FiveCardDrawState {
  return {
    ...state,
    deck: state.deck.map((c) => ({ ...c })),
    discardPile: state.discardPile.map((c) => ({ ...c })),
    config: { ...state.config },
    players: state.players.map((p) => ({
      ...p,
      cards: p.cards.map((c) => ({ ...c })),
      rank: p.rank
        ? {
            ...p.rank,
            tiebreakers: [...p.rank.tiebreakers] as [number, number, number, number, number],
            cards: p.rank.cards.map((c) => ({ ...c })),
          }
        : null,
    })),
  };
}

/** Mask a player's cards for the wire. */
function maskCards(cards: CardData[]): CardData[] {
  return cards.map(() => ({ suit: 'hidden' as const, rank: 'hidden' as const }));
}

/** First active player after `fromIdx` in seat order, wrapping. -1 if none. */
function nextActiveIdx(players: PlayerSlot[], fromIdx: number): number {
  const n = players.length;
  for (let step = 0; step < n; step++) {
    const i = (fromIdx + step) % n;
    if (players[i].status === 'active') return i;
  }
  return -1;
}

function indexOf(state: FiveCardDrawState, id: string): number {
  return state.players.findIndex((p) => p.id === id);
}

/**
 * Mutates state: advances `toAct` after the actor at `currentIdx` has
 * just acted. Returns true if the round closes (action returned to last
 * aggressor and everyone's matched, or only one player remains).
 */
function advanceWithinRound(state: FiveCardDrawState, currentIdx: number): boolean {
  const activeCount = state.players.filter((p) => p.status === 'active').length;
  if (activeCount <= 1) {
    state.toAct = null;
    return true;
  }
  const aggressorIdx = state.lastAggressorId ? indexOf(state, state.lastAggressorId) : -1;
  const nextIdx = nextActiveIdx(state.players, currentIdx + 1);
  if (nextIdx === -1) {
    state.toAct = null;
    return true;
  }
  // If we'd return to the aggressor and everyone has matched, round closes.
  if (aggressorIdx !== -1 && nextIdx === aggressorIdx) {
    const allMatched = state.players.every(
      (p) => p.status !== 'active' || p.currentBet === state.currentBet,
    );
    if (allMatched) {
      state.toAct = null;
      return true;
    }
  }
  // If no one bet this round (lastAggressorId === null) and we've come
  // back to the first active player, the round closes (a lap of checks).
  if (state.lastAggressorId === null) {
    const firstActive = nextActiveIdx(state.players, 0);
    if (nextIdx === firstActive) {
      // Everyone has had a turn at currentBet=0.
      state.toAct = null;
      return true;
    }
  }
  state.toAct = state.players[nextIdx].id;
  return false;
}

/** Transition from a closed betting round into the next phase. */
function endBettingRound(state: FiveCardDrawState): void {
  // Reset per-round counters.
  for (const p of state.players) {
    p.currentBet = 0;
  }
  state.currentBet = 0;
  state.minRaise = state.config.minBet;
  state.lastAggressorId = null;

  const activePlayers = state.players.filter((p) => p.status === 'active');
  if (activePlayers.length <= 1) {
    // Folded down — go straight to settle (no showdown needed since uncontested).
    state.phase = 'settled';
    state.toAct = null;
    finalizeShowdown(state);
    return;
  }

  switch (state.phase) {
    case 'betting_1': {
      state.phase = 'draw';
      // Mark only active players as needing to discard.
      for (const p of state.players) {
        p.hasDiscarded = p.status !== 'active';
      }
      const firstActive = nextActiveIdx(state.players, 0);
      state.toAct = firstActive === -1 ? null : state.players[firstActive].id;
      break;
    }
    case 'betting_2': {
      state.phase = 'showdown';
      state.toAct = null;
      finalizeShowdown(state);
      break;
    }
    default:
      throw new Error(`5cd: endBettingRound called in unexpected phase ${state.phase}`);
  }
}

/** Evaluate remaining hands, distribute pots, set phase = 'settled'. */
function finalizeShowdown(state: FiveCardDrawState): void {
  // Rank every non-folded player.
  for (const p of state.players) {
    if (p.status !== 'folded' && p.cards.length === 5) {
      p.rank = evaluateHand(p.cards);
    }
  }
  const pots = buildPots(
    state.players.map((p) => ({
      id: p.id,
      totalBet: p.totalBet,
      folded: p.status === 'folded',
    })),
  );
  const ranks = new Map(state.players.filter((p) => p.rank).map((p) => [p.id, p.rank!]));
  const awards = distributePots(
    pots,
    ranks,
    state.players.map((p) => p.id),
  );
  for (const award of awards) {
    const p = state.players.find((pl) => pl.id === award.id);
    if (p) {
      p.chips += award.amount;
      p.winnings += award.amount;
    }
  }
  state.phase = 'settled';
}

/**
 * After the draw phase: every active player has discarded, advance to
 * betting_2 with reset per-round state.
 */
function endDrawPhase(state: FiveCardDrawState): void {
  for (const p of state.players) {
    p.currentBet = 0;
  }
  state.currentBet = 0;
  state.minRaise = state.config.minBet;
  state.lastAggressorId = null;
  state.phase = 'betting_2';
  const firstActive = nextActiveIdx(state.players, 0);
  state.toAct = firstActive === -1 ? null : state.players[firstActive].id;
}

export const fiveCardDrawEngine: GameEngine<
  FiveCardDrawState,
  FiveCardDrawAction,
  FiveCardDrawView,
  FiveCardDrawConfig
> = {
  id: 'fivecarddraw',

  initialState(config, playerIds, rng) {
    if (playerIds.length < 2) {
      throw new Error('5cd: need at least 2 players');
    }
    const deck = freshDeck();
    shuffle(deck, rng);

    const players: PlayerSlot[] = playerIds.map((id) => {
      const stack = config.stacks[id];
      if (typeof stack !== 'number' || stack < config.ante) {
        throw new Error(
          `5cd: player ${id} cannot afford the ante (stack ${stack} < ante ${config.ante})`,
        );
      }
      return {
        id,
        cards: [],
        status: 'active',
        chips: stack - config.ante,
        currentBet: 0,
        totalBet: config.ante,
        hasDiscarded: false,
        rank: null,
        winnings: 0,
      };
    });

    // Deal 5 cards to each player.
    for (let cardIdx = 0; cardIdx < 5; cardIdx++) {
      for (const p of players) {
        p.cards.push(draw(deck));
      }
    }

    const firstActive = nextActiveIdx(players, 0);
    return {
      type: 'fivecarddraw',
      config: { ante: config.ante, minBet: config.minBet },
      deck,
      discardPile: [],
      players,
      phase: 'betting_1',
      toAct: firstActive === -1 ? null : players[firstActive].id,
      currentBet: 0,
      minRaise: config.minBet,
      lastAggressorId: null,
    };
  },

  legalActions(state, who) {
    if (who === 'spectator') return [];
    const p = state.players.find((pl) => pl.id === who);
    if (!p) return [];

    if (state.phase === 'draw') {
      if (state.toAct !== who || p.status !== 'active') return [];
      // Engine accepts any 0..5 unique indices; UI surfaces the picker.
      // We emit a single placeholder action; the caller picks indices.
      return [{ kind: 'discard', playerId: who, indices: [] }];
    }

    if ((state.phase === 'betting_1' || state.phase === 'betting_2') && state.toAct === who) {
      if (p.status !== 'active') return [];
      const owed = state.currentBet - p.currentBet;
      const acts: FiveCardDrawAction[] = [{ kind: 'fold', playerId: who }];
      if (owed === 0) {
        acts.push({ kind: 'check', playerId: who });
        if (p.chips > 0) {
          acts.push({ kind: 'bet', playerId: who, amount: state.config.minBet });
        }
      } else {
        if (p.chips > 0) {
          acts.push({ kind: 'call', playerId: who });
        }
        if (p.chips > owed) {
          acts.push({ kind: 'raise', playerId: who, amount: state.currentBet + state.minRaise });
        }
      }
      return acts;
    }

    return [];
  },

  applyAction(state, who, action) {
    const next = deepClone(state);

    if (action.kind === 'discard') {
      if (next.phase !== 'draw') {
        throw new Error('5cd: discard only legal during draw phase');
      }
      if (next.toAct !== who || next.toAct !== action.playerId) {
        throw new Error('5cd: not your turn to draw');
      }
      const p = findPlayer(next, action.playerId);
      if (p.status !== 'active') {
        throw new Error(`5cd: ${action.playerId} is ${p.status}, cannot draw`);
      }
      const { indices } = action;
      if (!Array.isArray(indices)) {
        throw new Error('5cd: discard indices must be an array');
      }
      const sorted = [...indices].sort((a, b) => a - b);
      const seen = new Set<number>();
      for (const i of sorted) {
        if (!Number.isInteger(i) || i < 0 || i > 4) {
          throw new Error(`5cd: invalid discard index ${i}`);
        }
        if (seen.has(i)) {
          throw new Error(`5cd: duplicate discard index ${i}`);
        }
        seen.add(i);
      }
      if (sorted.length > 5) {
        throw new Error('5cd: cannot discard more than 5 cards');
      }
      if (sorted.length > next.deck.length) {
        throw new Error('5cd: not enough cards left to draw');
      }
      // Discard high-to-low so subsequent splice indices remain valid.
      const discards: CardData[] = [];
      for (let k = sorted.length - 1; k >= 0; k--) {
        const idx = sorted[k];
        discards.push(p.cards[idx]);
        p.cards.splice(idx, 1);
      }
      next.discardPile.push(...discards);
      for (let k = 0; k < sorted.length; k++) {
        p.cards.push(draw(next.deck));
      }
      p.hasDiscarded = true;

      // Advance to next active player who hasn't discarded.
      const allDone = next.players.every((pl) => pl.status !== 'active' || pl.hasDiscarded);
      if (allDone) {
        endDrawPhase(next);
      } else {
        const myIdx = indexOf(next, who);
        // Find next active player who hasn't discarded.
        let nextIdx = -1;
        const n = next.players.length;
        for (let step = 1; step <= n; step++) {
          const i = (myIdx + step) % n;
          if (next.players[i].status === 'active' && !next.players[i].hasDiscarded) {
            nextIdx = i;
            break;
          }
        }
        next.toAct = nextIdx === -1 ? null : next.players[nextIdx].id;
      }
      return next;
    }

    // Betting actions.
    if (next.phase !== 'betting_1' && next.phase !== 'betting_2') {
      throw new Error(`5cd: ${action.kind} not legal in phase ${next.phase}`);
    }
    if (next.toAct !== who || next.toAct !== action.playerId) {
      throw new Error('5cd: not your turn');
    }
    const idx = indexOf(next, who);
    const p = next.players[idx];
    if (p.status !== 'active') {
      throw new Error(`5cd: ${action.playerId} is ${p.status}, cannot bet`);
    }

    switch (action.kind) {
      case 'fold':
        p.status = 'folded';
        break;
      case 'check':
        if (p.currentBet !== next.currentBet) {
          throw new Error('5cd: check illegal — must match the current bet');
        }
        break;
      case 'call': {
        const owed = next.currentBet - p.currentBet;
        if (owed <= 0) {
          throw new Error('5cd: nothing to call — use check');
        }
        const pay = Math.min(owed, p.chips);
        p.chips -= pay;
        p.currentBet += pay;
        p.totalBet += pay;
        if (p.chips === 0) p.status = 'all_in';
        break;
      }
      case 'bet': {
        if (next.currentBet !== 0) {
          throw new Error('5cd: a bet already exists — use raise');
        }
        if (!Number.isInteger(action.amount) || action.amount <= 0) {
          throw new Error('5cd: bet amount must be positive integer');
        }
        if (action.amount < next.config.minBet) {
          throw new Error(`5cd: bet ${action.amount} below table minimum (${next.config.minBet})`);
        }
        if (action.amount > p.chips) {
          throw new Error(`5cd: bet ${action.amount} exceeds stack ${p.chips}`);
        }
        p.chips -= action.amount;
        p.currentBet = action.amount;
        p.totalBet += action.amount;
        next.currentBet = action.amount;
        next.minRaise = action.amount;
        next.lastAggressorId = p.id;
        if (p.chips === 0) p.status = 'all_in';
        break;
      }
      case 'raise': {
        if (next.currentBet === 0) {
          throw new Error('5cd: nothing to raise — use bet');
        }
        if (!Number.isInteger(action.amount) || action.amount <= 0) {
          throw new Error('5cd: raise target must be positive integer');
        }
        const minTarget = next.currentBet + next.minRaise;
        if (action.amount < minTarget) {
          throw new Error(`5cd: raise to ${action.amount} below minimum (${minTarget})`);
        }
        const owed = action.amount - p.currentBet;
        if (owed > p.chips) {
          throw new Error(`5cd: raise needs ${owed} chips, have ${p.chips}`);
        }
        p.chips -= owed;
        p.currentBet = action.amount;
        p.totalBet += owed;
        next.minRaise = action.amount - next.currentBet;
        next.currentBet = action.amount;
        next.lastAggressorId = p.id;
        if (p.chips === 0) p.status = 'all_in';
        break;
      }
    }

    const closed = advanceWithinRound(next, idx);
    if (closed) {
      endBettingRound(next);
    }
    return next;
  },

  viewFor(state, viewer) {
    const reveal = state.phase === 'showdown' || state.phase === 'settled';
    const players = state.players.map((p) => ({
      id: p.id,
      cards: reveal || p.id === viewer ? p.cards.map((c) => ({ ...c })) : maskCards(p.cards),
      status: p.status,
      chips: p.chips,
      currentBet: p.currentBet,
      totalBet: p.totalBet,
      hasDiscarded: p.hasDiscarded,
      rank: reveal || p.id === viewer ? p.rank : null,
      winnings: p.winnings,
    }));

    const pot = {
      total: state.players.reduce((s, p) => s + p.totalBet, 0),
      currentBet: state.currentBet,
      minRaise: state.minRaise,
    };

    const legalActions =
      viewer === 'spectator' ? [] : fiveCardDrawEngine.legalActions(state, viewer);

    return {
      type: 'fivecarddraw',
      config: { ante: state.config.ante, minBet: state.config.minBet },
      players,
      phase: state.phase,
      toAct: state.toAct,
      pot,
      legalActions,
    };
  },

  aiAction(state, slotId) {
    return fiveCardDrawAiAction(state, slotId);
  },

  isTerminal(state) {
    return state.phase === 'settled';
  },

  settle(state): SettlementOrder[] {
    const orders: SettlementOrder[] = [];
    for (const p of state.players) {
      // delta = (chips returned to player from pot) - (chips they put in)
      const delta = p.winnings - p.totalBet;
      const reason = (() => {
        if (p.status === 'folded') return 'fold';
        if (p.winnings === 0) return 'lose';
        if (p.winnings > p.totalBet) return 'win';
        if (p.winnings === p.totalBet) return 'push';
        return 'lose';
      })();
      orders.push({ playerId: p.id, delta, reason });
    }
    return orders;
  },
};

/**
 * Simple passive AI for 5-card draw.
 *
 *   draw phase    → keep any paired cards; if no pair, keep the two
 *                   highest and discard the bottom three.
 *   betting phases:
 *     pair-or-better → check (free) or call (facing a bet)
 *     high card only → check if free, fold if facing a bet
 *
 * Never raises (passive) and never bluffs. Easy to extend later with
 * pot-odds, hand-strength tiers, occasional aggression, etc.
 */
function fiveCardDrawAiAction(state: FiveCardDrawState, slotId: string): FiveCardDrawAction {
  const slot = state.players.find((p) => p.id === slotId);
  if (!slot) throw new Error(`5cd AI: unknown slot ${slotId}`);

  if (state.phase === 'draw') {
    return { kind: 'discard', playerId: slotId, indices: pickDiscards(slot.cards) };
  }

  if (state.phase === 'betting_1' || state.phase === 'betting_2') {
    const owed = state.currentBet - slot.currentBet;
    const handRank = evaluateHand(slot.cards);
    const hasPairOrBetter = CATEGORY_VALUE[handRank.category] >= CATEGORY_VALUE.one_pair;

    if (owed === 0) {
      return { kind: 'check', playerId: slotId };
    }
    return hasPairOrBetter
      ? { kind: 'call', playerId: slotId }
      : { kind: 'fold', playerId: slotId };
  }

  throw new Error(`5cd AI: cannot act in phase ${state.phase}`);
}

/** Indices of the cards to discard given a 5-card hand. */
function pickDiscards(cards: CardData[]): number[] {
  if (cards.length !== 5) return [];
  const values = cards.map((c) => cardValue(c));
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  // Keep cards that are part of any pair/trips/quads.
  const pairedIndices = new Set(values.flatMap((v, i) => ((counts.get(v) ?? 0) >= 2 ? [i] : [])));

  if (pairedIndices.size > 0) {
    return [0, 1, 2, 3, 4].filter((i) => !pairedIndices.has(i));
  }

  // No paired cards — keep the top two by rank, discard the bottom three.
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const keep = new Set(sorted.slice(0, 2).map((x) => x.i));
  return [0, 1, 2, 3, 4].filter((i) => !keep.has(i));
}

/** Re-export of `compareHandRanks` for engines downstream that want it. */
export { compareHandRanks };
