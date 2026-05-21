import { prisma } from 'db.server';
import type { user } from '@prisma/client';

/**
 * AI player provisioning. Tables fill empty seats with synthetic users
 * (`is_ai: true`) so single-human flows can still play a real multi-seat
 * game.
 *
 * Strategy: **ephemeral per hand**. Each `getAvailableAIUsers(n)` call
 * inserts N fresh `user` rows with names picked from `AI_NAMES`. Bots
 * are not reused across hands — each hand gets its own set, so there's
 * no "busy pool" to exhaust and no coordination across concurrent
 * `startHand` calls.
 *
 * Tradeoff: old AI user rows accumulate in `user` as dead data after
 * their hand settles. They cost effectively nothing (a row each, no
 * money flow, no logins, no relations beyond the historical hand_seat
 * they participated in). A periodic GC could remove AI users with no
 * unsettled hand activity if the table ever gets uncomfortably large.
 *
 * AI bankrolls default to a very large number — they're not meant to
 * "run out" — but real money never flows in or out of an AI account in
 * practice because their settlements net to zero against the casino
 * (their wins/losses against humans go to/from the humans).
 */

const AI_NAMES = [
  'Bot-Alpha',
  'Bot-Bravo',
  'Bot-Charlie',
  'Bot-Delta',
  'Bot-Echo',
  'Bot-Foxtrot',
  'Bot-Golf',
  'Bot-Hotel',
  'Bot-India',
  'Bot-Juliet',
  'Bot-Kilo',
  'Bot-Lima',
  'Bot-Mike',
  'Bot-November',
  'Bot-Oscar',
  'Bot-Papa',
  'Bot-Quebec',
  'Bot-Romeo',
  'Bot-Sierra',
  'Bot-Tango',
] as const;

const AI_STARTING_BALANCE = 1_000_000;

/**
 * Return `n` freshly-minted AI user rows for use at a table. Each call
 * creates new rows — bots are never reused across hands. Names are
 * picked from `AI_NAMES` without repetition within a single call, so a
 * given table won't have two "Bot-Alpha"s at once. (If n exceeds the
 * name pool size we fall back to allowing repeats.)
 */
export async function getAvailableAIUsers(n: number): Promise<user[]> {
  if (n < 0) throw new Error(`getAvailableAIUsers: n must be non-negative, got ${n}`);
  if (n === 0) return [];

  const picks = pickNames(n);
  // One transaction wrapping N inserts. `createMany` would be a single
  // statement but doesn't return the inserted rows on Postgres, which
  // the caller needs (each row's id flows into a hand_seat).
  return prisma.$transaction(
    picks.map((name) =>
      prisma.user.create({
        data: { name, is_ai: true, money: AI_STARTING_BALANCE },
      }),
    ),
  );
}

/**
 * Pick `n` bot names. Distinct (Fisher-Yates shuffle) when there are
 * enough names to satisfy the request; allows repetition otherwise.
 */
function pickNames(n: number): string[] {
  if (n <= AI_NAMES.length) {
    const pool: string[] = [...AI_NAMES];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }
  return Array.from({ length: n }, () => AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)]);
}
