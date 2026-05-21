import { z } from 'zod';
import { CardSchema } from 'lib/gameState';
import { ActorStatusSchema, HandRankSchema } from '../shared/schemas';

/**
 * Runtime schema for `FiveCardDrawState` — what gets persisted in
 * `hand.data` for 5-card draw hands. Mirrors the TypeScript type in
 * `./types.ts`. `pokerEngine.server.ts` parses every read through this
 * so corrupt or hand-edited rows surface as a clean ZodError instead
 * of producing undefined behavior in the engine.
 */

export const FiveCardDrawPhaseSchema = z.enum([
  'awaiting_deal',
  'betting_1',
  'draw',
  'betting_2',
  'showdown',
  'settled',
]);

export const FiveCardDrawPlayerSlotSchema = z.object({
  id: z.string(),
  cards: z.array(CardSchema),
  status: ActorStatusSchema,
  chips: z.number().int().nonnegative(),
  currentBet: z.number().int().nonnegative(),
  totalBet: z.number().int().nonnegative(),
  hasDiscarded: z.boolean(),
  rank: HandRankSchema.nullable(),
  winnings: z.number().int().nonnegative(),
});

export const FiveCardDrawStateSchema = z.object({
  type: z.literal('fivecarddraw'),
  config: z.object({
    ante: z.number().int().nonnegative(),
    minBet: z.number().int().nonnegative(),
  }),
  deck: z.array(CardSchema),
  discardPile: z.array(CardSchema),
  players: z.array(FiveCardDrawPlayerSlotSchema),
  phase: FiveCardDrawPhaseSchema,
  toAct: z.string().nullable(),
  /** Default null so pre-timer-feature snapshots still parse cleanly. */
  turnDeadlineAt: z.string().nullable().optional().default(null),
  currentBet: z.number().int().nonnegative(),
  minRaise: z.number().int().nonnegative(),
  lastAggressorId: z.string().nullable(),
});
