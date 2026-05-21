import { z } from 'zod';
import { CardSchema } from 'lib/gameState';
import { ActorStatusSchema, HandRankSchema } from '../shared/schemas';

/**
 * Runtime schema for `HoldemState`. Mirrors `./types.ts`. Parsed by
 * `holdemEngine.server.ts` on every read of `hand.data`.
 */

export const HoldemPhaseSchema = z.enum([
  'preflop',
  'flop',
  'turn',
  'river',
  'showdown',
  'settled',
]);

export const HoldemPlayerSlotSchema = z.object({
  id: z.string(),
  holeCards: z.array(CardSchema),
  status: ActorStatusSchema,
  chips: z.number().int().nonnegative(),
  currentBet: z.number().int().nonnegative(),
  totalBet: z.number().int().nonnegative(),
  hasActedThisRound: z.boolean(),
  rank: HandRankSchema.nullable(),
  winnings: z.number().int().nonnegative(),
});

export const HoldemStateSchema = z.object({
  type: z.literal('holdem'),
  config: z.object({
    smallBlind: z.number().int().nonnegative(),
    bigBlind: z.number().int().nonnegative(),
  }),
  deck: z.array(CardSchema),
  community: z.array(CardSchema),
  burnPile: z.array(CardSchema),
  players: z.array(HoldemPlayerSlotSchema),
  phase: HoldemPhaseSchema,
  toAct: z.string().nullable(),
  turnDeadlineAt: z.string().nullable().optional().default(null),
  currentBet: z.number().int().nonnegative(),
  minRaise: z.number().int().nonnegative(),
  lastAggressorId: z.string().nullable(),
  dealerIdx: z.number().int().nonnegative(),
});
