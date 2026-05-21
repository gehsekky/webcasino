import { z } from 'zod';
import { CardSchema } from 'lib/gameState';

/**
 * Runtime-validated shapes shared between 5-card draw and Hold'em. Mirrors
 * the TypeScript types in `bettingRound.ts` and `types.ts`. Used by each
 * engine's wrapper to parse `hand.data` on every read so corruption or
 * hand-edited rows can't smuggle invalid state into the engine.
 */

export const ActorStatusSchema = z.enum(['active', 'folded', 'all_in']);

export const HandCategorySchema = z.enum([
  'high_card',
  'one_pair',
  'two_pair',
  'three_of_a_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_a_kind',
  'straight_flush',
]);

/**
 * A scored 5-card best hand. Tiebreakers are the rank values of the five
 * cards in comparison order (highest first), used to break ties within a
 * category.
 */
export const HandRankSchema = z.object({
  category: HandCategorySchema,
  tiebreakers: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
  cards: z.array(CardSchema),
});
