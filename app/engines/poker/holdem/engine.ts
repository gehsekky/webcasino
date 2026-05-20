import type { GameEngine, RNG, SettlementOrder } from '../../types';
import type { CardData, Suit, Rank } from 'lib/gameState';
import { bestHandFrom } from '../shared/bestHandFrom';
import { buildPots, distributePots } from '../shared/pot';
import { CATEGORY_VALUE } from '../shared/types';
import type {
  HoldemAction,
  HoldemConfig,
  HoldemPlayerSlot,
  HoldemState,
  HoldemView,
} from './types';

/**
 * Texas Hold'em engine. State machine matches the standard:
 *   blinds posted → preflop bet → flop deal + bet → turn deal + bet →
 *   river deal + bet → showdown → settle.
 *
 * Betting-round mechanics (current bet, min raise, who acts when, when a
 * round closes) intentionally mirror the 5-card draw engine. Sharing the
 * betting-round helper from `shared/bettingRound.ts` was considered but
 * sticking with inline implementation matches the 5cd engine's style and
 * keeps each engine self-contained. Refactor to shared once both engines
 * have settled.
 */

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
  if (!c) throw new Error('holdem: deck empty');
  return c;
}

function findPlayer(state: HoldemState, id: string): HoldemPlayerSlot {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`holdem: unknown player ${id}`);
  return p;
}

function indexOf(state: HoldemState, id: string): number {
  return state.players.findIndex((p) => p.id === id);
}

function maskCards(cards: CardData[]): CardData[] {
  return cards.map(() => ({ suit: 'hidden' as const, rank: 'hidden' as const }));
}

function deepClone(state: HoldemState): HoldemState {
  return {
    ...state,
    deck: state.deck.map((c) => ({ ...c })),
    community: state.community.map((c) => ({ ...c })),
    burnPile: state.burnPile.map((c) => ({ ...c })),
    config: { ...state.config },
    players: state.players.map((p) => ({
      ...p,
      holeCards: p.holeCards.map((c) => ({ ...c })),
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

/** Index of the next active actor after `fromIdx`, wrapping. -1 if none. */
function nextActiveIdx(players: HoldemPlayerSlot[], fromIdx: number): number {
  const n = players.length;
  for (let step = 0; step < n; step++) {
    const i = (fromIdx + step) % n;
    if (players[i].status === 'active') return i;
  }
  return -1;
}

/**
 * Determine which seat acts first preflop given the dealer position.
 *
 *   2 players (heads-up): dealer is the small blind and acts first.
 *   3+ players: UTG (one left of the big blind) acts first.
 *
 * Skips folded/all-in seats — though at this point, only blinds-posted
 * all-ins would have non-active status, and only when the player is
 * shorter than their blind (degenerate case).
 */
function firstToActPreflop(players: HoldemPlayerSlot[], dealerIdx: number): number {
  if (players.length === 2) {
    return nextActiveIdx(players, dealerIdx);
  }
  // big blind is dealer + 2; UTG is dealer + 3
  return nextActiveIdx(players, dealerIdx + 3);
}

/**
 * Determine first to act for any postflop round (flop/turn/river).
 *
 *   2 players: big blind acts first (= the non-dealer).
 *   3+ players: small blind acts first (= dealer + 1).
 */
function firstToActPostflop(players: HoldemPlayerSlot[], dealerIdx: number): number {
  if (players.length === 2) {
    // Non-dealer acts first postflop.
    return nextActiveIdx(players, dealerIdx + 1);
  }
  return nextActiveIdx(players, dealerIdx + 1);
}

/**
 * Advance to the next actor (or close the round). Mirrors the closure
 * rules from the 5cd engine: round closes when action would return to the
 * last aggressor with everyone matched, OR when a full lap of checks has
 * been completed with no aggressor.
 */
function advanceWithinRound(state: HoldemState, currentIdx: number): boolean {
  const activeCount = state.players.filter((p) => p.status === 'active').length;
  if (activeCount <= 1) {
    state.toAct = null;
    return true;
  }
  const nextIdx = nextActiveIdx(state.players, currentIdx + 1);
  if (nextIdx === -1) {
    state.toAct = null;
    return true;
  }

  // Round closes when every active player has voluntarily acted this
  // round AND their currentBet matches the current bet. This handles the
  // big blind's preflop option correctly: BB starts with hasActedThisRound
  // = false even though their blind contribution already equals
  // currentBet, so the round can't close until they get their turn.
  const allActiveSatisfied = state.players.every(
    (p) => p.status !== 'active' || (p.hasActedThisRound && p.currentBet === state.currentBet),
  );
  if (allActiveSatisfied) {
    state.toAct = null;
    return true;
  }

  state.toAct = state.players[nextIdx].id;
  return false;
}

/** Transition out of a closed betting round into the next phase. */
function endBettingRound(state: HoldemState): void {
  // Reset per-round counters.
  for (const p of state.players) {
    p.currentBet = 0;
    p.hasActedThisRound = false;
  }
  state.currentBet = 0;
  state.minRaise = state.config.bigBlind;
  state.lastAggressorId = null;

  const activePlayers = state.players.filter((p) => p.status === 'active');
  if (activePlayers.length <= 1) {
    // Folded down — uncontested pot. Award and settle.
    state.phase = 'settled';
    state.toAct = null;
    finalizeShowdown(state);
    return;
  }

  switch (state.phase) {
    case 'preflop':
      dealFlop(state);
      state.phase = 'flop';
      break;
    case 'flop':
      dealTurnOrRiver(state);
      state.phase = 'turn';
      break;
    case 'turn':
      dealTurnOrRiver(state);
      state.phase = 'river';
      break;
    case 'river':
      state.phase = 'showdown';
      state.toAct = null;
      finalizeShowdown(state);
      return;
    default:
      throw new Error(`holdem: endBettingRound called in unexpected phase ${state.phase}`);
  }

  // After a community deal, if at most one player still has chips, no
  // further betting can happen — burn through the remaining streets and
  // go directly to showdown.
  const canStillBet = state.players.filter((p) => p.status === 'active' && p.chips > 0).length;
  if (canStillBet <= 1) {
    while (state.community.length < 5) {
      dealTurnOrRiver(state);
    }
    state.phase = 'showdown';
    state.toAct = null;
    finalizeShowdown(state);
    return;
  }

  const firstIdx = firstToActPostflop(state.players, state.dealerIdx);
  state.toAct = firstIdx === -1 ? null : state.players[firstIdx].id;
}

/** Burn one, deal three to the community. */
function dealFlop(state: HoldemState): void {
  state.burnPile.push(draw(state.deck));
  for (let i = 0; i < 3; i++) state.community.push(draw(state.deck));
}

/** Burn one, deal one to the community (turn or river). */
function dealTurnOrRiver(state: HoldemState): void {
  state.burnPile.push(draw(state.deck));
  state.community.push(draw(state.deck));
}

/** Evaluate all remaining hands, distribute pots, mark settled. */
function finalizeShowdown(state: HoldemState): void {
  // Reveal community cards even if folded-down: render-time only needs
  // them dealt for a settled hand. (Here, fold-down doesn't deal extra
  // community cards — only contested showdowns reach river+evaluate.)
  for (const p of state.players) {
    if (p.status !== 'folded' && p.holeCards.length === 2 && state.community.length >= 3) {
      p.rank = bestHandFrom([...p.holeCards, ...state.community]);
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
 * Post the small + big blinds, accounting for short stacks (a player
 * shorter than their blind goes all-in for less). Sets currentBet to the
 * big blind, minRaise to bigBlind, lastAggressorId to the big-blind
 * seat (so the round closes when action returns to BB with everyone matched).
 */
function postBlinds(state: HoldemState): void {
  const n = state.players.length;
  const dealerIdx = state.dealerIdx;
  const sbIdx = n === 2 ? dealerIdx : (dealerIdx + 1) % n;
  const bbIdx = n === 2 ? (dealerIdx + 1) % n : (dealerIdx + 2) % n;

  const sb = state.players[sbIdx];
  const bb = state.players[bbIdx];

  const sbAmount = Math.min(state.config.smallBlind, sb.chips);
  sb.chips -= sbAmount;
  sb.currentBet = sbAmount;
  sb.totalBet = sbAmount;
  if (sb.chips === 0) sb.status = 'all_in';

  const bbAmount = Math.min(state.config.bigBlind, bb.chips);
  bb.chips -= bbAmount;
  bb.currentBet = bbAmount;
  bb.totalBet = bbAmount;
  if (bb.chips === 0) bb.status = 'all_in';

  state.currentBet = state.config.bigBlind;
  state.minRaise = state.config.bigBlind;
  // No aggressor: posting blinds isn't a voluntary action. The big blind
  // gets their option preflop (check or raise) once action returns to
  // them, gated by `hasActedThisRound` on each player.
  state.lastAggressorId = null;
}

export const holdemEngine: GameEngine<HoldemState, HoldemAction, HoldemView, HoldemConfig> = {
  id: 'holdem',

  initialState(config, playerIds, rng) {
    if (playerIds.length < 2) {
      throw new Error('holdem: need at least 2 players');
    }
    const deck = freshDeck();
    shuffle(deck, rng);

    const players: HoldemPlayerSlot[] = playerIds.map((id) => {
      const stack = config.stacks[id];
      if (typeof stack !== 'number' || stack <= 0) {
        throw new Error(`holdem: player ${id} stack must be > 0 (got ${stack})`);
      }
      return {
        id,
        holeCards: [],
        status: 'active',
        chips: stack,
        currentBet: 0,
        totalBet: 0,
        hasActedThisRound: false,
        rank: null,
        winnings: 0,
      };
    });

    // Deal 2 hole cards per player, round-robin.
    for (let cardIdx = 0; cardIdx < 2; cardIdx++) {
      for (const p of players) {
        p.holeCards.push(draw(deck));
      }
    }

    const state: HoldemState = {
      type: 'holdem',
      config: { smallBlind: config.smallBlind, bigBlind: config.bigBlind },
      deck,
      community: [],
      burnPile: [],
      players,
      phase: 'preflop',
      toAct: null,
      currentBet: 0,
      minRaise: config.bigBlind,
      lastAggressorId: null,
      dealerIdx: 0,
    };
    postBlinds(state);

    const startIdx = firstToActPreflop(state.players, state.dealerIdx);
    state.toAct = startIdx === -1 ? null : state.players[startIdx].id;
    return state;
  },

  legalActions(state, who) {
    if (who === 'spectator') return [];
    const p = state.players.find((pl) => pl.id === who);
    if (!p) return [];
    if (state.toAct !== who) return [];
    if (p.status !== 'active') return [];
    if (state.phase === 'showdown' || state.phase === 'settled') return [];

    const owed = state.currentBet - p.currentBet;
    const acts: HoldemAction[] = [{ kind: 'fold', playerId: who }];
    if (owed === 0) {
      acts.push({ kind: 'check', playerId: who });
      if (p.chips > 0) {
        acts.push({ kind: 'bet', playerId: who, amount: state.config.bigBlind });
      }
    } else {
      if (p.chips > 0) acts.push({ kind: 'call', playerId: who });
      if (p.chips > owed) {
        acts.push({ kind: 'raise', playerId: who, amount: state.currentBet + state.minRaise });
      }
    }
    return acts;
  },

  applyAction(state, who, action) {
    const next = deepClone(state);
    if (next.phase === 'showdown' || next.phase === 'settled') {
      throw new Error(`holdem: cannot act in phase ${next.phase}`);
    }
    if (next.toAct !== who || next.toAct !== action.playerId) {
      throw new Error('holdem: not your turn');
    }
    const idx = indexOf(next, who);
    const p = next.players[idx];
    if (p.status !== 'active') {
      throw new Error(`holdem: ${action.playerId} is ${p.status}, cannot act`);
    }

    p.hasActedThisRound = true;
    switch (action.kind) {
      case 'fold':
        p.status = 'folded';
        break;
      case 'check':
        if (p.currentBet !== next.currentBet) {
          throw new Error('holdem: check illegal — must match the current bet');
        }
        break;
      case 'call': {
        const owed = next.currentBet - p.currentBet;
        if (owed <= 0) throw new Error('holdem: nothing to call — use check');
        const pay = Math.min(owed, p.chips);
        p.chips -= pay;
        p.currentBet += pay;
        p.totalBet += pay;
        if (p.chips === 0) p.status = 'all_in';
        break;
      }
      case 'bet': {
        if (next.currentBet !== 0) {
          throw new Error('holdem: a bet already exists — use raise');
        }
        if (!Number.isInteger(action.amount) || action.amount <= 0) {
          throw new Error('holdem: bet amount must be positive integer');
        }
        if (action.amount < next.config.bigBlind) {
          throw new Error(`holdem: bet ${action.amount} below big blind (${next.config.bigBlind})`);
        }
        if (action.amount > p.chips) {
          throw new Error(`holdem: bet ${action.amount} exceeds stack ${p.chips}`);
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
          throw new Error('holdem: nothing to raise — use bet');
        }
        if (!Number.isInteger(action.amount) || action.amount <= 0) {
          throw new Error('holdem: raise target must be positive integer');
        }
        const minTarget = next.currentBet + next.minRaise;
        if (action.amount < minTarget) {
          throw new Error(`holdem: raise to ${action.amount} below minimum (${minTarget})`);
        }
        const owed = action.amount - p.currentBet;
        if (owed > p.chips) {
          throw new Error(`holdem: raise needs ${owed} chips, have ${p.chips}`);
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
      cards:
        reveal || p.id === viewer ? p.holeCards.map((c) => ({ ...c })) : maskCards(p.holeCards),
      status: p.status,
      chips: p.chips,
      currentBet: p.currentBet,
      totalBet: p.totalBet,
      rank: reveal || p.id === viewer ? p.rank : null,
      winnings: p.winnings,
    }));

    const pot = {
      total: state.players.reduce((s, p) => s + p.totalBet, 0),
      currentBet: state.currentBet,
      minRaise: state.minRaise,
    };

    const legalActions = viewer === 'spectator' ? [] : holdemEngine.legalActions(state, viewer);

    return {
      type: 'holdem',
      config: { smallBlind: state.config.smallBlind, bigBlind: state.config.bigBlind },
      players,
      community: state.community.map((c) => ({ ...c })),
      phase: state.phase,
      toAct: state.toAct,
      pot,
      legalActions,
      dealerIdx: state.dealerIdx,
    };
  },

  aiAction(state, slotId) {
    return holdemAiAction(state, slotId);
  },

  isTerminal(state) {
    return state.phase === 'settled';
  },

  settle(state): SettlementOrder[] {
    const orders: SettlementOrder[] = [];
    for (const p of state.players) {
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
 * Passive AI for Hold'em.
 *
 * Strategy:
 *   - If we have ≥ 5 cards (post-flop), evaluate best 5-of-N and call/check
 *     with pair-or-better; otherwise fold to bets, check when free.
 *   - Pre-flop (only 2 hole cards), call/check freely as long as the call
 *     doesn't exceed 10% of stack; otherwise fold to bets, check when free.
 *
 * Never raises (passive). Plays for engagement, not strength.
 */
function holdemAiAction(state: HoldemState, slotId: string): HoldemAction {
  const slot = state.players.find((p) => p.id === slotId);
  if (!slot) throw new Error(`holdem AI: unknown slot ${slotId}`);
  const owed = state.currentBet - slot.currentBet;

  const visibleCards = [...slot.holeCards, ...state.community];

  if (visibleCards.length >= 5) {
    const handRank = bestHandFrom(visibleCards);
    const decent = CATEGORY_VALUE[handRank.category] >= CATEGORY_VALUE.one_pair;
    if (owed === 0) {
      return { kind: 'check', playerId: slotId };
    }
    return decent ? { kind: 'call', playerId: slotId } : { kind: 'fold', playerId: slotId };
  }

  // Preflop: cheap-call heuristic.
  if (owed === 0) {
    return { kind: 'check', playerId: slotId };
  }
  const cheap = owed <= Math.max(state.config.bigBlind, Math.floor((slot.chips + owed) * 0.1));
  return cheap ? { kind: 'call', playerId: slotId } : { kind: 'fold', playerId: slotId };
}

/** Helper used by the form parser layer to validate `action.kind` strings. */
void findPlayer;
