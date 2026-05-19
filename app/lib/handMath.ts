import type { CardData } from 'lib/gameState';

const FACE_VALUES: Record<string, number> = {
  Jack: 10,
  Queen: 10,
  King: 10,
};

/**
 * Sum a hand's value using standard blackjack ace handling: aces start at
 * 11 and demote to 1 whenever the total would otherwise bust. Hidden cards
 * count as 0 (used for the dealer's down card during the player's turn).
 */
export function handTotal(cards: CardData[]): number {
  let sum = 0;
  let hasAce = false;
  for (const card of cards) {
    if (card.rank === 'Ace') {
      sum += 11;
      hasAce = true;
    } else if (FACE_VALUES[card.rank] !== undefined) {
      sum += FACE_VALUES[card.rank];
    } else if (card.rank === 'hidden') {
      // Unknown card — contributes 0 to the visible total.
    } else {
      sum += parseInt(card.rank, 10);
    }
  }
  if (sum > 21 && hasAce) {
    sum -= 10;
  }
  return sum;
}

/** True when a 2-card hand totals 21. */
export function isNaturalBlackjack(cards: CardData[]): boolean {
  return cards.length === 2 && handTotal(cards) === 21;
}

/** True if any card in the hand is masked (e.g. dealer's down card). */
export function hasHiddenCard(cards: CardData[]): boolean {
  return cards.some((c) => c.suit === 'hidden' || c.rank === 'hidden');
}
