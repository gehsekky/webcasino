import type { CardData } from 'lib/gameState';
import { cardValue, type HandCategory, type HandRank } from './types';

/**
 * Score a 5-card poker hand.
 *
 * Pure function. Doesn't mutate its input. Throws if the hand isn't
 * exactly 5 cards or contains an unknown rank.
 *
 * Implementation: a single pass over the cards builds the rank histogram,
 * suit count, and sorted value list. Category detection runs once on
 * those; tiebreakers are derived from the histogram.
 */
export function evaluateHand(cards: CardData[]): HandRank {
  if (cards.length !== 5) {
    throw new Error(`evaluateHand: expected 5 cards, got ${cards.length}`);
  }

  const values = cards.map(cardValue);
  const sortedValues = [...values].sort((a, b) => b - a); // descending

  // Rank histogram: value → count.
  const histogram = new Map<number, number>();
  for (const v of values) {
    histogram.set(v, (histogram.get(v) ?? 0) + 1);
  }

  // Buckets of (count, value), sorted by count desc then value desc.
  // E.g. for two pair K-K-Q-Q-7: [[2, 13], [2, 12], [1, 7]]
  const buckets: Array<[count: number, value: number]> = [...histogram.entries()]
    .map(([v, c]) => [c, v] as [number, number])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);

  const isFlush = cards.every((c) => c.suit === cards[0].suit);

  // Straight check. Sort ascending, dedupe (a straight has 5 distinct ranks).
  const ascending = [...values].sort((a, b) => a - b);
  const distinct = [...new Set(ascending)];
  let straightHigh: number | null = null;
  if (distinct.length === 5) {
    if (distinct[4] - distinct[0] === 4) {
      straightHigh = distinct[4];
    } else if (
      distinct[0] === 2 &&
      distinct[1] === 3 &&
      distinct[2] === 4 &&
      distinct[3] === 5 &&
      distinct[4] === 14
    ) {
      // Wheel A-2-3-4-5 — ace plays low, high card is the 5.
      straightHigh = 5;
    }
  }

  let category: HandCategory;
  let tb: [number, number, number, number, number];

  if (straightHigh !== null && isFlush) {
    category = 'straight_flush';
    tb = [straightHigh, 0, 0, 0, 0];
  } else if (buckets[0][0] === 4) {
    // Four of a kind: [quad value, kicker]
    category = 'four_of_a_kind';
    tb = [buckets[0][1], buckets[1][1], 0, 0, 0];
  } else if (buckets[0][0] === 3 && buckets[1][0] === 2) {
    // Full house: [trips value, pair value]
    category = 'full_house';
    tb = [buckets[0][1], buckets[1][1], 0, 0, 0];
  } else if (isFlush) {
    // Flush: all 5 values descending
    category = 'flush';
    tb = [sortedValues[0], sortedValues[1], sortedValues[2], sortedValues[3], sortedValues[4]];
  } else if (straightHigh !== null) {
    category = 'straight';
    tb = [straightHigh, 0, 0, 0, 0];
  } else if (buckets[0][0] === 3) {
    // Trips: [trips value, kicker1, kicker2]
    const kickers = buckets
      .slice(1)
      .map(([, v]) => v)
      .sort((a, b) => b - a);
    category = 'three_of_a_kind';
    tb = [buckets[0][1], kickers[0], kickers[1], 0, 0];
  } else if (buckets[0][0] === 2 && buckets[1][0] === 2) {
    // Two pair: [higher pair, lower pair, kicker]
    // buckets already sorted (count desc, value desc), so buckets[0] is higher pair.
    category = 'two_pair';
    tb = [buckets[0][1], buckets[1][1], buckets[2][1], 0, 0];
  } else if (buckets[0][0] === 2) {
    // One pair: [pair value, k1, k2, k3]
    const kickers = buckets
      .slice(1)
      .map(([, v]) => v)
      .sort((a, b) => b - a);
    category = 'one_pair';
    tb = [buckets[0][1], kickers[0], kickers[1], kickers[2], 0];
  } else {
    // High card: all 5 values descending
    category = 'high_card';
    tb = [sortedValues[0], sortedValues[1], sortedValues[2], sortedValues[3], sortedValues[4]];
  }

  return { category, tiebreakers: tb, cards: [...cards] };
}
