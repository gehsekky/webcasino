import type { CardData } from 'lib/gameState';

/**
 * Standard poker hand categories ordered low → high.
 *
 *   high_card        7 4 3 9 J
 *   one_pair         7 7 K Q 4
 *   two_pair         7 7 Q Q 4
 *   three_of_a_kind  7 7 7 Q 4
 *   straight         5 6 7 8 9
 *   flush            all same suit
 *   full_house       7 7 7 Q Q
 *   four_of_a_kind   7 7 7 7 Q
 *   straight_flush   straight + flush (royal is just A-high straight flush)
 */
export type HandCategory =
  | 'high_card'
  | 'one_pair'
  | 'two_pair'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush';

/** Numeric rank for ordering categories. Higher is better. */
export const CATEGORY_VALUE: Record<HandCategory, number> = {
  high_card: 0,
  one_pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
};

/** Human-readable label per category. */
export const CATEGORY_LABEL: Record<HandCategory, string> = {
  high_card: 'High Card',
  one_pair: 'One Pair',
  two_pair: 'Two Pair',
  three_of_a_kind: 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  full_house: 'Full House',
  four_of_a_kind: 'Four of a Kind',
  straight_flush: 'Straight Flush',
};

/**
 * A scored 5-card hand. `tiebreakers` is a length-5 tuple compared
 * lexicographically *within* a category; padded with 0 when fewer values
 * are needed. Cross-category comparison uses `CATEGORY_VALUE[category]`.
 *
 * Examples:
 *   K-K-Q-Q-7 (two pair, K & Q, kicker 7) → tiebreakers [13, 12, 7, 0, 0]
 *   8-7-6-5-4 straight                    → tiebreakers [8, 0, 0, 0, 0]
 *   A-2-3-4-5 wheel                       → tiebreakers [5, 0, 0, 0, 0]
 */
export type HandRank = {
  category: HandCategory;
  tiebreakers: [number, number, number, number, number];
  /** Original cards that made up the scored 5-card hand. */
  cards: CardData[];
};

/**
 * Compare two hand ranks. Negative if a < b, positive if a > b, zero if tied.
 * Used by `pot.distribute` and showdown.
 */
export function compareHandRanks(a: HandRank, b: HandRank): number {
  const catDiff = CATEGORY_VALUE[a.category] - CATEGORY_VALUE[b.category];
  if (catDiff !== 0) return catDiff;
  for (let i = 0; i < 5; i++) {
    if (a.tiebreakers[i] !== b.tiebreakers[i]) {
      return a.tiebreakers[i] - b.tiebreakers[i];
    }
  }
  return 0;
}

/**
 * Numeric rank value of a card. Aces are high (14) by default; straight
 * detection separately handles the wheel (A-2-3-4-5) case.
 */
export const RANK_VALUE: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  Jack: 11,
  Queen: 12,
  King: 13,
  Ace: 14,
};

export function cardValue(card: CardData): number {
  const v = RANK_VALUE[card.rank];
  if (v === undefined) {
    throw new Error(`cardValue: unknown rank '${card.rank}' (hidden cards can't be scored)`);
  }
  return v;
}
