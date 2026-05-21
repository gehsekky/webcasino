import { z } from 'zod';
import { CardSchema } from 'lib/gameState';

/**
 * Runtime schema for `BaccaratState`. Parsed by `baccaratEngine.server.ts`
 * on every read of `hand.data`.
 */

export const BaccaratBetKindSchema = z.enum(['player', 'banker', 'tie']);

export const BaccaratPhaseSchema = z.enum(['awaiting_bets', 'settled']);

export const BaccaratOutcomeSchema = z.enum(['player', 'banker', 'tie']);

export const BaccaratBetSchema = z.object({
  id: z.string(),
  kind: BaccaratBetKindSchema,
  amount: z.number().int().nonnegative(),
  payout: z.number().int().nonnegative(),
  pushed: z.boolean(),
});

export const BaccaratPlayerSlotSchema = z.object({
  id: z.string(),
  bets: z.array(BaccaratBetSchema),
  totalStake: z.number().int().nonnegative(),
  winnings: z.number().int().nonnegative(),
});

export const BaccaratStateSchema = z.object({
  type: z.literal('baccarat'),
  config: z.object({
    minimumBet: z.number().int().nonnegative(),
    maximumBet: z.number().int().nonnegative(),
    numDecks: z.number().int().min(1).max(8),
    tiePayout: z.number().int().nonnegative(),
  }),
  deck: z.array(CardSchema),
  playerHand: z.array(CardSchema),
  bankerHand: z.array(CardSchema),
  players: z.array(BaccaratPlayerSlotSchema),
  phase: BaccaratPhaseSchema,
  toAct: z.string().nullable(),
  outcome: BaccaratOutcomeSchema.nullable(),
  playerTotal: z.number().int().min(0).max(9).nullable(),
  bankerTotal: z.number().int().min(0).max(9).nullable(),
});
