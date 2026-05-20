import { prisma } from 'db.server';
import type { user } from '@prisma/client';

/**
 * AI player provisioning. Tables fill empty seats with synthetic users
 * (`is_ai: true`) so single-human flows can still play a real multi-seat
 * game. Names are pulled from `AI_NAMES`; we lazily insert any that don't
 * exist yet and reuse the rest.
 *
 * AI bankrolls default to a very large number — they're not meant to
 * "run out" — but real money never flows in or out of an AI account in
 * practice because their settlements net to zero against the casino
 * (their wins/losses against humans go to/from the humans).
 *
 * `getAvailableAIUsers(n)` returns N AI accounts, creating any that are
 * missing. Caller is expected to seat them at a single hand at a time
 * (we don't track lock state — the pool is large relative to concurrent
 * tables).
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
 * Ensure all canonical AI users exist in the DB. Idempotent — safe to
 * call eagerly at app start or lazily before each hand creation.
 */
export async function ensureAIUserPool(): Promise<void> {
  const existing = await prisma.user.findMany({
    where: { is_ai: true, name: { in: [...AI_NAMES] } },
    select: { name: true },
  });
  const have = new Set(existing.map((u) => u.name));
  const missing = AI_NAMES.filter((n) => !have.has(n));
  if (missing.length === 0) return;
  await prisma.user.createMany({
    data: missing.map((name) => ({
      name,
      is_ai: true,
      money: AI_STARTING_BALANCE,
    })),
  });
}

/**
 * Return `n` AI user rows for use at a table. Bots currently seated at
 * a hand whose latest persisted state hasn't reached `phase === 'settled'`
 * are considered busy and excluded — this keeps the same Bot-Alpha row
 * from being mutated by two settle paths in parallel (see TODO entry on
 * money concurrency).
 *
 * Note: the pick isn't atomic against concurrent `startHand` calls — two
 * simultaneous starts could both see Bot-Alpha free and both claim her.
 * Acceptable in practice for now (much rarer than the previous
 * always-overlap behaviour); a fully race-free fix would either run
 * `startHand` in SERIALIZABLE or introduce a claim row in its own table.
 *
 * Throws when `n` exceeds the canonical pool size, or when the pool is
 * exhausted by currently-active hands.
 */
export async function getAvailableAIUsers(n: number): Promise<user[]> {
  if (n < 0) throw new Error(`getAvailableAIUsers: n must be non-negative, got ${n}`);
  if (n === 0) return [];
  if (n > AI_NAMES.length) {
    throw new Error(`getAvailableAIUsers: requested ${n} but pool max is ${AI_NAMES.length}`);
  }
  await ensureAIUserPool();

  // Walk every AI hand_seat row (pool is small and bounded), check the
  // attached hand's persisted phase, and treat anyone not yet settled as
  // unavailable.
  const aiHandSeats = await prisma.hand_seat.findMany({
    where: { user: { is_ai: true } },
    select: {
      user_id: true,
      hand: { select: { data: true } },
    },
  });
  const busyIds = new Set<string>();
  for (const hs of aiHandSeats) {
    const phase = (hs.hand.data as { phase?: string } | null)?.phase;
    if (phase && phase !== 'settled') {
      busyIds.add(hs.user_id);
    }
  }

  const available = await prisma.user.findMany({
    where: {
      is_ai: true,
      name: { in: [...AI_NAMES] },
      id: { notIn: [...busyIds] },
    },
    orderBy: { created_at: 'asc' },
    take: n,
  });
  if (available.length < n) {
    throw new Error(
      `getAvailableAIUsers: requested ${n} but only ${available.length} free ` +
        `(${busyIds.size}/${AI_NAMES.length} busy in active hands)`,
    );
  }
  return available;
}

export const AI_USER_NAMES = AI_NAMES;
