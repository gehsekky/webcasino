import type { CardData, BlackjackState, PlayerSlot, Phase, PlayerStatus } from 'lib/gameState';

export type { BlackjackState, PlayerSlot, Phase, PlayerStatus };

export type BlackjackAction =
  | { kind: 'place_bet'; playerId: string; amount: number }
  | { kind: 'deal_initial' }
  | { kind: 'take_insurance'; playerId: string; amount: number }
  | { kind: 'decline_insurance'; playerId: string }
  | { kind: 'hit'; playerId: string }
  | { kind: 'stay'; playerId: string }
  | { kind: 'double_down'; playerId: string }
  | { kind: 'split'; playerId: string }
  | { kind: 'surrender'; playerId: string }
  | { kind: 'dealer_play' };

export type BlackjackConfig = {
  minimumBet: number;
  maximumBet: number;
  /** Decks shuffled into the shoe. 1 by default; casinos typically use 4-8. */
  numDecks: number;
  /** Hit-soft-17 (H17) vs stand-on-all-17 (S17) house rule. */
  dealerHitsSoft17: boolean;
};

/**
 * A viewer's perspective of the state. Server private info (the deck) is
 * stripped; dealer's hole card is masked until revealed.
 */
export type BlackjackView = {
  type: 'blackjack';
  config: { minimumBet: number; maximumBet: number };
  dealerHand: CardData[];
  dealerCardsRevealed: boolean;
  players: PlayerSlot[];
  phase: Phase;
  toAct: string | null;
  /**
   * ISO timestamp when the current human seat's turn auto-folds. `null`
   * when no one is on the clock (toAct is null or AI). Clients render
   * this as a countdown badge.
   */
  turnDeadlineAt: string | null;
  /** Actions legal for this viewer. */
  legalActions: BlackjackAction[];
};
