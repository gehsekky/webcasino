import { z } from 'zod';

/**
 * Runtime schema for `RouletteState`. Parsed by `rouletteEngine.server.ts`
 * on every read of `hand.data`.
 */

export const BetKindSchema = z.enum([
  'straight',
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'column1',
  'column2',
  'column3',
]);

export const RoulettePhaseSchema = z.enum(['awaiting_bets', 'settled']);

export const RouletteBetSchema = z.object({
  id: z.string(),
  kind: BetKindSchema,
  amount: z.number().int().nonnegative(),
  /** Required only for straight bets; absent for outside bets. */
  number: z.number().int().min(0).max(36).optional(),
  payout: z.number().int().nonnegative(),
});

export const RoulettePlayerSlotSchema = z.object({
  id: z.string(),
  bets: z.array(RouletteBetSchema),
  totalStake: z.number().int().nonnegative(),
  winnings: z.number().int().nonnegative(),
});

export const RouletteStateSchema = z.object({
  type: z.literal('roulette'),
  config: z.object({
    minimumBet: z.number().int().nonnegative(),
    maximumBet: z.number().int().nonnegative(),
  }),
  players: z.array(RoulettePlayerSlotSchema),
  phase: RoulettePhaseSchema,
  toAct: z.string().nullable(),
  result: z.number().int().min(0).max(36).nullable(),
});
