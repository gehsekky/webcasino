import type { CardData } from 'lib/gameState';
import type { ActorStatus } from '../shared/bettingRound';
import type { HandRank } from '../shared/types';

/**
 * Phases of a Texas Hold'em hand.
 *
 *   preflop    — 2 hole cards each, blinds posted, first betting round
 *   flop       — 3 community cards dealt, second betting round
 *   turn       — 4th community card dealt, third betting round
 *   river      — 5th community card dealt, fourth (final) betting round
 *   showdown   — best 5-of-7 hand per active player; pots distributed
 *   settled    — terminal
 *
 * `awaiting_deal` isn't modeled: `initialState` returns a state already
 * in `preflop` with blinds posted and cards dealt.
 */
export type HoldemPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'settled';

/**
 * Per-player slot. The engine evolves these in place; the seat layer
 * (hand_seat row in DB) maps each id to a user.
 */
export type HoldemPlayerSlot = {
  id: string;
  /** Hidden from other players until showdown. */
  holeCards: CardData[];
  status: ActorStatus;
  /** Chips remaining in the stack at this table. */
  chips: number;
  /** Amount contributed this betting round (resets between rounds). */
  currentBet: number;
  /** Amount contributed across all rounds this hand (used for side-pot math). */
  totalBet: number;
  /**
   * True iff this player has voluntarily acted this round (call/check/
   * bet/raise/fold). Resets to false between rounds. Used to give the big
   * blind their "option" preflop — posting a blind doesn't count.
   */
  hasActedThisRound: boolean;
  /** Hand rank populated at showdown for awarding pots. */
  rank: HandRank | null;
  /** Pot winnings credited to this player at settle. */
  winnings: number;
};

export type HoldemState = {
  type: 'holdem';
  config: {
    /** Small blind amount. */
    smallBlind: number;
    /** Big blind amount (also the minimum opening bet / raise increment). */
    bigBlind: number;
  };
  /** Shuffled deck (top = end of array; pop to draw). */
  deck: CardData[];
  /** Community cards revealed so far (0, 3, 4, or 5). */
  community: CardData[];
  /** Cards burnt before each post-preflop deal, kept for audit. */
  burnPile: CardData[];
  players: HoldemPlayerSlot[];
  phase: HoldemPhase;
  /** id of the player whose turn it is, or null when no one is acting. */
  toAct: string | null;
  /** Highest bet anyone has placed this round. */
  currentBet: number;
  /** Minimum legal next-raise size. */
  minRaise: number;
  /** id of the last actor who bet/raised this round. null if no aggressor. */
  lastAggressorId: string | null;
  /**
   * Seat index of the dealer button. Heads-up rules apply when only 2
   * players are seated: dealer is also the small blind and acts first
   * preflop. Multi-way: dealer is the button, +1 = SB, +2 = BB, +3 = UTG.
   *
   * For first version this is always 0 (no rotation between hands).
   */
  dealerIdx: number;
};

/**
 * Actions the engine accepts. No `discard` — Hold'em doesn't have a draw.
 */
export type HoldemAction =
  | { kind: 'fold'; playerId: string }
  | { kind: 'check'; playerId: string }
  | { kind: 'call'; playerId: string }
  | { kind: 'bet'; playerId: string; amount: number }
  | { kind: 'raise'; playerId: string; amount: number };

export type HoldemConfig = {
  smallBlind: number;
  bigBlind: number;
  /** Starting chip stack per player id. */
  stacks: Record<string, number>;
};

/** Pot info exposed to the client. */
export type HoldemPotSnapshot = {
  total: number;
  currentBet: number;
  minRaise: number;
};

/**
 * Per-player projection in the view. Hole cards masked for other players
 * unless the hand has reached showdown.
 *
 * Field name `cards` matches the 5-card draw view shape on purpose so the
 * UI's `PokerSeat` component can render both games without an adapter.
 */
export type HoldemPlayerView = {
  id: string;
  cards: CardData[];
  status: ActorStatus;
  chips: number;
  currentBet: number;
  totalBet: number;
  rank: HandRank | null;
  winnings: number;
};

export type HoldemView = {
  type: 'holdem';
  config: { smallBlind: number; bigBlind: number };
  players: HoldemPlayerView[];
  community: CardData[];
  phase: HoldemPhase;
  toAct: string | null;
  pot: HoldemPotSnapshot;
  legalActions: HoldemAction[];
  dealerIdx: number;
};
