import type { CardData } from 'lib/gameState';
import { evaluateHand } from './handEval';
import { compareHandRanks, type HandRank } from './types';

/**
 * Given N ≥ 5 cards, return the highest-ranked 5-card hand achievable.
 *
 * In Texas Hold'em a player has 2 hole cards + 5 community cards = 7
 * total, and the best 5-card subset wins. Enumerating C(7,5) = 21
 * combinations is cheap; for larger N the cost grows combinatorially but
 * stays well within "fine for a poker hand."
 *
 * Returns the winning `HandRank` (with the underlying 5 cards attached).
 */
export function bestHandFrom(cards: CardData[]): HandRank {
  if (cards.length < 5) {
    throw new Error(`bestHandFrom: need at least 5 cards, got ${cards.length}`);
  }
  if (cards.length === 5) {
    return evaluateHand(cards);
  }

  let best: HandRank | null = null;
  for (const combo of combinations(cards, 5)) {
    const rank = evaluateHand(combo);
    if (!best || compareHandRanks(rank, best) > 0) {
      best = rank;
    }
  }
  // `best` is non-null because we asserted cards.length >= 5 above.
  return best as HandRank;
}

/** Lazy generator yielding every k-combination of `arr`. */
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}
