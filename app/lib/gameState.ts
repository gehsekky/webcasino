import { z } from 'zod';

export const SUITS = ['hearts', 'spades', 'clubs', 'diamonds', 'hidden'] as const;
export const RANKS = [
  'Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'Jack', 'Queen', 'King', 'hidden',
] as const;

export type Suit = typeof SUITS[number];
export type Rank = typeof RANKS[number];

export const CardSchema = z.object({
  suit: z.enum(SUITS),
  rank: z.enum(RANKS),
});
export type CardData = z.infer<typeof CardSchema>;

export const BlackjackStateSchema = z.object({
  type: z.literal('blackjack'),
  minimumBet: z.number().int().nonnegative(),
  maximumBet: z.number().int().nonnegative(),
  deck: z.array(CardSchema),
  dealerHand: z.array(CardSchema),
  dealerCardsRevealed: z.boolean(),
});
export type BlackjackState = z.infer<typeof BlackjackStateSchema>;

/**
 * Discriminated union over all game state shapes. Add a new variant when
 * adding a new engine (e.g. PokerStateSchema, SlotsStateSchema).
 */
export const GameStateSchema = z.discriminatedUnion('type', [
  BlackjackStateSchema,
]);
export type GameState = z.infer<typeof GameStateSchema>;

export const GamePlayerStateSchema = z.object({
  cards: z.array(CardSchema),
});
export type GamePlayerState = z.infer<typeof GamePlayerStateSchema>;

/** Parse a row's JSON `data` column into a typed BlackjackState. Throws on shape mismatch. */
export function parseBlackjackState(input: unknown): BlackjackState {
  return BlackjackStateSchema.parse(input);
}

/** Parse a row's JSON `data` column into a typed GamePlayerState. Throws on shape mismatch. */
export function parseGamePlayerState(input: unknown): GamePlayerState {
  return GamePlayerStateSchema.parse(input);
}

/**
 * Legacy type aliases kept so existing call sites that import `GameData`
 * / `GamePlayerData` continue to compile. Task #6 (engine refactor) will
 * remove these in favor of the inferred names.
 */
export type GameData = BlackjackState;
export type GamePlayerData = GamePlayerState;
