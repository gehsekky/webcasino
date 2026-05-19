import type { CardData } from 'lib/gameState';

export type PlayerStatus =
  | 'awaiting_bet'
  | 'in_hand'
  | 'stood'
  | 'busted'
  | 'surrendered'
  | 'won'
  | 'lost'
  | 'pushed'
  | 'blackjack';

export type PlayerSlot = {
  id: string;
  cards: CardData[];
  bet: number;
  /** True if the player has doubled down on this hand. */
  doubled: boolean;
  status: PlayerStatus;
};

export type Phase = 'awaiting_bets' | 'playing' | 'dealer' | 'settled';

export type BlackjackState = {
  type: 'blackjack';
  config: {
    minimumBet: number;
    maximumBet: number;
  };
  deck: CardData[];
  dealerHand: CardData[];
  dealerCardsRevealed: boolean;
  players: PlayerSlot[];
  phase: Phase;
  /** Id of the player whose turn it is, or null. */
  toAct: string | null;
};

export type BlackjackAction =
  | { kind: 'place_bet'; playerId: string; amount: number }
  | { kind: 'deal_initial' }
  | { kind: 'hit'; playerId: string }
  | { kind: 'stay'; playerId: string }
  | { kind: 'double_down'; playerId: string }
  | { kind: 'surrender'; playerId: string }
  | { kind: 'dealer_play' };

export type BlackjackConfig = {
  minimumBet: number;
  maximumBet: number;
  playerIds: string[];
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
  /** Actions legal for this viewer. */
  legalActions: BlackjackAction[];
};
