import type { CardData } from 'lib/gameState';

const FACE_VALUES: Record<string, number> = {
  Jack: 10,
  Queen: 10,
  King: 10,
};

export type HandTotal = {
  /** Best total — soft total if it doesn't bust, otherwise the hard total. */
  total: number;
  /**
   * True when an ace in the hand is currently being counted as 11. Used by
   * the dealer's H17 rule (hit on soft 17) and by player strategy aids.
   */
  isSoft: boolean;
};

/**
 * Compute the hand total *and* whether it's currently "soft" (an ace counted
 * as 11 without busting). Aces start at 1; we promote exactly one to 11 if
 * that keeps the total at 21 or under.
 */
export function handTotalDetail(cards: CardData[]): HandTotal {
  let sum = 0;
  let aceCount = 0;
  for (const card of cards) {
    if (card.rank === 'Ace') {
      sum += 1;
      aceCount += 1;
    } else if (FACE_VALUES[card.rank] !== undefined) {
      sum += FACE_VALUES[card.rank];
    } else if (card.rank === 'hidden') {
      // Unknown card — contributes 0 to the visible total.
    } else {
      sum += parseInt(card.rank, 10);
    }
  }
  // Promote one ace from 1 → 11 if it doesn't bust the hand.
  let isSoft = false;
  if (aceCount > 0 && sum + 10 <= 21) {
    sum += 10;
    isSoft = true;
  }
  return { total: sum, isSoft };
}

/**
 * Just the total, soft-promoted when possible. Equivalent to
 * `handTotalDetail(cards).total`.
 */
export function handTotal(cards: CardData[]): number {
  return handTotalDetail(cards).total;
}

/** True when a 2-card hand totals 21. */
export function isNaturalBlackjack(cards: CardData[]): boolean {
  return cards.length === 2 && handTotal(cards) === 21;
}

/** True if any card in the hand is masked (e.g. dealer's down card). */
export function hasHiddenCard(cards: CardData[]): boolean {
  return cards.some((c) => c.suit === 'hidden' || c.rank === 'hidden');
}
