import { z } from 'zod';

export const SUITS = ['hearts', 'spades', 'clubs', 'diamonds', 'hidden'] as const;
export const RANKS = [
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
  'hidden',
] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export const CardSchema = z.object({
  suit: z.enum(SUITS),
  rank: z.enum(RANKS),
});
export type CardData = z.infer<typeof CardSchema>;

export const PlayerStatusSchema = z.enum([
  'awaiting_bet',
  'in_hand',
  'stood',
  'busted',
  'surrendered',
  'won',
  'lost',
  'pushed',
  'blackjack',
]);

export const PhaseSchema = z.enum([
  'awaiting_bets',
  'insurance_offered',
  'playing',
  'dealer',
  'settled',
]);

export const PlayerSlotSchema = z.object({
  id: z.string(),
  cards: z.array(CardSchema),
  bet: z.number().int().nonnegative(),
  doubled: z.boolean(),
  status: PlayerStatusSchema,
  /**
   * Player's insurance side-bet.
   *  - `null`: no decision yet (insurance offered, player hasn't acted)
   *  - `0`: insurance declined
   *  - positive: insurance amount placed (max floor(bet / 2))
   * Fields default to `null` so pre-insurance hand snapshots remain parseable.
   */
  insuranceBet: z.number().int().nonnegative().nullable().default(null),
  /**
   * Set on a *split* sibling — the id of the original slot it was split
   * from. Null for original (top-level) slots. Settlement looks up the
   * owning user via the parent slot since the sibling has no hand_seat row.
   */
  parentSlotId: z.string().nullable().default(null),
});
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type PlayerSlot = z.infer<typeof PlayerSlotSchema>;

export const BlackjackConfigSchema = z.object({
  minimumBet: z.number().int().nonnegative(),
  maximumBet: z.number().int().nonnegative(),
  /** How many 52-card decks are shuffled together into the shoe. */
  numDecks: z.number().int().min(1).max(8).default(1),
  /** If true, dealer hits soft 17 (H17). If false, dealer stands on all 17 (S17). */
  dealerHitsSoft17: z.boolean().default(false),
});

export const BlackjackStateSchema = z.object({
  type: z.literal('blackjack'),
  config: BlackjackConfigSchema,
  deck: z.array(CardSchema),
  dealerHand: z.array(CardSchema),
  dealerCardsRevealed: z.boolean(),
  players: z.array(PlayerSlotSchema),
  phase: PhaseSchema,
  toAct: z.string().nullable(),
  /**
   * ISO timestamp by which the current human seat must act before the
   * server applies an auto-action on their behalf. `null` when no one
   * is on the clock (round closed, settled, or `toAct` is an AI seat).
   * Wrapper computes this; engines just carry it through.
   *
   * Defaults to null so hands persisted before this field was added
   * still parse cleanly.
   */
  turnDeadlineAt: z.string().nullable().default(null),
});
export type BlackjackState = z.infer<typeof BlackjackStateSchema>;

/**
 * Discriminated union over all game state shapes. Add a new variant when
 * adding a new engine (e.g. PokerStateSchema, SlotsStateSchema).
 */
export const GameStateSchema = z.discriminatedUnion('type', [BlackjackStateSchema]);
export type GameState = z.infer<typeof GameStateSchema>;
