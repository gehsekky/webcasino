import type { CardData } from 'lib/gameState';

/**
 * Punto Banco baccarat. Two hands ("Punto" / Player and "Banco" / Banker)
 * are dealt by the engine; the bettors place chips on Player, Banker, or
 * Tie before the deal and have no decisions during the hand — all draws
 * are forced by the tableau.
 */

export type BaccaratPhase = 'awaiting_bets' | 'settled';

export type BaccaratBetKind = 'player' | 'banker' | 'tie';

export const BACCARAT_BET_KINDS: readonly BaccaratBetKind[] = ['player', 'banker', 'tie'] as const;

export const BACCARAT_BET_LABEL: Record<BaccaratBetKind, string> = {
  player: 'Player',
  banker: 'Banker',
  tie: 'Tie',
};

/** Payout multiplier on a winning bet, applied to the stake. */
export const BACCARAT_PAYOUT: Record<BaccaratBetKind, number> = {
  // Banker is implicit 1:1 minus 5% commission — wrapper handles the
  // commission, so the raw multiplier here is the gross 1.
  player: 1,
  banker: 1,
  tie: 8,
};

/** Banker commission rate (deducted from winnings on Banker bets). */
export const BANKER_COMMISSION = 0.05;

export type BaccaratBet = {
  id: string;
  kind: BaccaratBetKind;
  amount: number;
  /** Set at settle: positive = won (post-commission for Banker), 0 = lost or pushed. */
  payout: number;
  /** Set at settle for Player / Banker bets when the hand was a tie. */
  pushed: boolean;
};

export type BaccaratPlayerSlot = {
  id: string;
  bets: BaccaratBet[];
  /** Sum of bet amounts (running stake total). */
  totalStake: number;
  /** Sum of payouts (running winnings). */
  winnings: number;
};

export type BaccaratOutcome = 'player' | 'banker' | 'tie';

export type BaccaratState = {
  type: 'baccarat';
  config: {
    minimumBet: number;
    maximumBet: number;
    /** Number of 52-card decks in the shoe. 8 in a standard punto banco shoe. */
    numDecks: number;
    /** Multiplier the Tie bet pays. 8 (8:1) is most common; 9:1 is rarer. */
    tiePayout: number;
  };
  /** Shuffled shoe (top = end of array; `pop()` to draw). */
  deck: CardData[];
  /** Cards dealt to the Player hand. 2 or 3 cards. */
  playerHand: CardData[];
  /** Cards dealt to the Banker hand. 2 or 3 cards. */
  bankerHand: CardData[];
  players: BaccaratPlayerSlot[];
  phase: BaccaratPhase;
  /** Bookkeeping: first player's id in awaiting_bets, null after deal. */
  toAct: string | null;
  outcome: BaccaratOutcome | null;
  /** Final hand totals (0-9), populated at settle. */
  playerTotal: number | null;
  bankerTotal: number | null;
};

export type BaccaratAction =
  | {
      kind: 'place_bet';
      playerId: string;
      bet: { kind: BaccaratBetKind; amount: number };
    }
  | { kind: 'deal'; playerId: string };

export type BaccaratConfig = {
  minimumBet: number;
  maximumBet: number;
  numDecks?: number;
  tiePayout?: number;
};

export type BaccaratView = {
  type: 'baccarat';
  config: { minimumBet: number; maximumBet: number; numDecks: number; tiePayout: number };
  players: BaccaratPlayerSlot[];
  playerHand: CardData[];
  bankerHand: CardData[];
  phase: BaccaratPhase;
  toAct: string | null;
  outcome: BaccaratOutcome | null;
  playerTotal: number | null;
  bankerTotal: number | null;
  legalActions: BaccaratAction[];
};

/**
 * Baccarat card value mapping:
 *   Ace = 1
 *   2..9 = face value
 *   10, Jack, Queen, King = 0
 */
export function cardValue(card: CardData): number {
  switch (card.rank) {
    case 'Ace':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    case '4':
      return 4;
    case '5':
      return 5;
    case '6':
      return 6;
    case '7':
      return 7;
    case '8':
      return 8;
    case '9':
      return 9;
    case '10':
    case 'Jack':
    case 'Queen':
    case 'King':
      return 0;
    case 'hidden':
      throw new Error('baccarat: cannot value a hidden card');
  }
}

/** Hand total mod 10 — the highest single digit is what counts. */
export function handTotal(cards: CardData[]): number {
  let sum = 0;
  for (const c of cards) sum += cardValue(c);
  return sum % 10;
}

/**
 * Punto Banco third-card "tableau" for the Banker. Returns true if the
 * Banker draws a third card given (a) the Banker's two-card total and
 * (b) the value of the Player's third card if drawn (null if the
 * Player stood).
 *
 * Rules (Player drew):
 *   Banker 0–2: always draw.
 *   Banker 3:   draw unless Player's third = 8.
 *   Banker 4:   draw on Player's third ∈ {2,3,4,5,6,7}.
 *   Banker 5:   draw on Player's third ∈ {4,5,6,7}.
 *   Banker 6:   draw on Player's third ∈ {6,7}.
 *   Banker 7:   always stand.
 *
 * If Player stood (had 6 or 7 on first two cards):
 *   Banker uses the simple rule — draw on 0–5, stand on 6–7.
 *
 * Naturals (8/9) skip the tableau entirely and are filtered upstream.
 */
export function bankerDraws(bankerTotal: number, playerThirdValue: number | null): boolean {
  if (playerThirdValue === null) {
    return bankerTotal <= 5;
  }
  switch (bankerTotal) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return playerThirdValue !== 8;
    case 4:
      return playerThirdValue >= 2 && playerThirdValue <= 7;
    case 5:
      return playerThirdValue >= 4 && playerThirdValue <= 7;
    case 6:
      return playerThirdValue === 6 || playerThirdValue === 7;
    case 7:
      return false;
    default:
      return false;
  }
}
