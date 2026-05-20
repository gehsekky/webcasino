import type { CardData } from 'lib/gameState';
import type { ActorStatus } from '../shared/bettingRound';
import type { HandRank } from '../shared/types';

/**
 * Phases of a 5-card draw hand.
 *
 *   awaiting_deal  — bookkeeping; ante taken and cards dealt then transitions
 *   betting_1      — first betting round, after the deal
 *   draw           — each remaining player picks 0-5 cards to swap
 *   betting_2      — second betting round, after the draw
 *   showdown       — evaluate hands; pot distributed
 *   settled        — terminal
 *
 * The engine never sits in `awaiting_deal` for an external action — it's
 * the input state the wrapper builds before calling `applyAction` with a
 * sentinel-style `deal_hand` (or `initialState` auto-deals on creation).
 * In practice the engine's initialState produces a state that's already
 * in `betting_1`.
 */
export type Phase = 'awaiting_deal' | 'betting_1' | 'draw' | 'betting_2' | 'showdown' | 'settled';

/**
 * Per-player slot. The engine evolves these in place; the seat layer
 * (hand_seat row in DB) maps each id to a user.
 */
export type PlayerSlot = {
  id: string;
  cards: CardData[];
  status: ActorStatus;
  /** Chips remaining in the stack at this table. */
  chips: number;
  /** Amount contributed this betting round (resets between rounds). */
  currentBet: number;
  /** Amount contributed across all rounds this hand (used for side-pot math). */
  totalBet: number;
  /** Whether this player has completed their draw this hand. */
  hasDiscarded: boolean;
  /** Hand rank populated at showdown for awarding pots. */
  rank: HandRank | null;
  /** Pot winnings credited to this player at settle (for views/audit). */
  winnings: number;
};

export type FiveCardDrawState = {
  type: 'fivecarddraw';
  config: {
    /** Forced contribution per player at the start of the hand. */
    ante: number;
    /** Smallest legal bet/raise. */
    minBet: number;
  };
  /** Shuffled deck (top = end of array; pop to draw). */
  deck: CardData[];
  /** Cards discarded during the draw phase, kept for audit. */
  discardPile: CardData[];
  players: PlayerSlot[];
  phase: Phase;
  /** id of the player whose turn it is, or null when no one is acting. */
  toAct: string | null;
  /** Highest bet anyone has placed this round. 0 → checks are legal. */
  currentBet: number;
  /** Minimum legal next-raise size. */
  minRaise: number;
  /** id of the last actor who bet/raised this round. null if no aggressor yet. */
  lastAggressorId: string | null;
};

/**
 * Actions the engine accepts. `dealer` actions (deal, advance to next
 * phase) are internal — the player-facing surface is below.
 */
export type FiveCardDrawAction =
  | { kind: 'fold'; playerId: string }
  | { kind: 'check'; playerId: string }
  | { kind: 'call'; playerId: string }
  | { kind: 'bet'; playerId: string; amount: number }
  | { kind: 'raise'; playerId: string; amount: number }
  /** Indices (0-4) of cards to discard. Empty array = stand pat. */
  | { kind: 'discard'; playerId: string; indices: number[] };

export type FiveCardDrawConfig = {
  ante: number;
  minBet: number;
  /** Starting chip stack per player id. Must include every entry in playerIds. */
  stacks: Record<string, number>;
};

/** Pot info exposed to the client. */
export type PotSnapshot = {
  /** Sum of every player's totalBet so far this hand. */
  total: number;
  /** Highest bet in the current round (matches engine `currentBet`). */
  currentBet: number;
  /** Minimum legal next-raise size. */
  minRaise: number;
};

/**
 * Per-player projection in the view. Other players' hole cards are
 * masked unless the hand has reached showdown.
 */
export type PlayerView = {
  id: string;
  cards: CardData[];
  status: ActorStatus;
  chips: number;
  currentBet: number;
  totalBet: number;
  hasDiscarded: boolean;
  /** Populated for the viewer's own hand once at least one card is dealt. */
  rank: HandRank | null;
  winnings: number;
};

export type FiveCardDrawView = {
  type: 'fivecarddraw';
  config: { ante: number; minBet: number };
  players: PlayerView[];
  phase: Phase;
  toAct: string | null;
  pot: PotSnapshot;
  legalActions: FiveCardDrawAction[];
};
