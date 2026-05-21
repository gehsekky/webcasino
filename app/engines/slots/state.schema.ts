import { z } from 'zod';

/**
 * Runtime schema for `SlotsState`. Parsed by `slotsEngine.server.ts`
 * on every read of `hand.data`.
 */

export const SlotsSymbolSchema = z.enum(['cherry', 'lemon', 'bell', 'bar', 'seven']);

export const SlotsPayoutKindSchema = z.enum([
  'three_cherry',
  'three_lemon',
  'three_bell',
  'three_bar',
  'three_seven',
  'two_seven',
  'lose',
]);

export const SlotsPhaseSchema = z.enum(['awaiting_bet', 'settled']);

export const SlotsPlayerSlotSchema = z.object({
  id: z.string(),
  stake: z.number().int().nonnegative(),
  reels: z.array(SlotsSymbolSchema),
  winnings: z.number().int().nonnegative(),
  payoutKind: SlotsPayoutKindSchema.nullable(),
});

export const SlotsStateSchema = z.object({
  type: z.literal('slots'),
  config: z.object({
    minimumBet: z.number().int().nonnegative(),
    maximumBet: z.number().int().nonnegative(),
  }),
  players: z.array(SlotsPlayerSlotSchema),
  phase: SlotsPhaseSchema,
  toAct: z.string().nullable(),
});
