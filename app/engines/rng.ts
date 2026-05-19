import { randomInt } from 'node:crypto';
import type { RNG } from './types';

/**
 * CSPRNG-backed RNG. Uses Node's `crypto.randomInt` so shuffles and deck
 * draws are cryptographically unpredictable, suitable for real-money play.
 * Server-only — importing this from a browser bundle will fail at module
 * load and that's intentional.
 *
 * Future work (see TODO.md "destination state"): commit-reveal seeding so
 * players can verify the shuffle was fair after the hand ends.
 */
export const defaultRng: RNG = {
  randInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`randInt: maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    return randomInt(0, maxExclusive);
  },
};

/**
 * Deterministic RNG seeded with an array of pre-chosen integers. Pops the
 * next value on each call. Useful for unit-testing engine behavior without
 * randomness.
 */
export function seededRng(values: number[]): RNG {
  const queue = [...values];
  return {
    randInt(maxExclusive: number): number {
      const v = queue.shift();
      if (v === undefined) {
        throw new Error('seededRng: out of values');
      }
      if (v < 0 || v >= maxExclusive) {
        throw new Error(`seededRng: value ${v} out of range [0, ${maxExclusive})`);
      }
      return v;
    },
  };
}
