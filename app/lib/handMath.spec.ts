import { describe, it, expect } from 'vitest';
import { handTotal, handTotalDetail, isNaturalBlackjack, hasHiddenCard } from './handMath';
import type { CardData } from './gameState';

const c = (suit: CardData['suit'], rank: CardData['rank']): CardData => ({ suit, rank });

describe('handTotal', () => {
  it('sums numeric cards', () => {
    expect(handTotal([c('hearts', '2'), c('spades', '5'), c('clubs', '9')])).toBe(16);
  });

  it('counts faces as 10', () => {
    expect(handTotal([c('hearts', 'Jack'), c('spades', 'Queen'), c('clubs', 'King')])).toBe(30);
  });

  it('counts a lone ace as 11 when it fits', () => {
    expect(handTotal([c('hearts', 'Ace')])).toBe(11);
  });

  it('demotes ace to 1 to avoid bust', () => {
    expect(handTotal([c('hearts', 'Ace'), c('spades', '8'), c('clubs', '5')])).toBe(14);
  });

  it('two aces total 12 (one as 11, one as 1)', () => {
    expect(handTotal([c('hearts', 'Ace'), c('spades', 'Ace')])).toBe(12);
  });

  it('hidden cards contribute 0', () => {
    expect(handTotal([c('hidden', 'hidden'), c('hearts', '7')])).toBe(7);
  });
});

describe('handTotalDetail', () => {
  it('marks a hand soft when an ace is counted as 11', () => {
    const detail = handTotalDetail([c('hearts', 'Ace'), c('spades', '6')]);
    expect(detail).toEqual({ total: 17, isSoft: true });
  });

  it('marks the hand hard when no ace is promoted', () => {
    const detail = handTotalDetail([c('hearts', '10'), c('spades', '7')]);
    expect(detail).toEqual({ total: 17, isSoft: false });
  });

  it('soft 17 → hard 17 once a ten lands and the ace must demote', () => {
    const detail = handTotalDetail([c('hearts', 'Ace'), c('spades', '6'), c('clubs', '10')]);
    // 1 + 6 + 10 = 17, ace stays at 1 (promoting would bust at 27)
    expect(detail).toEqual({ total: 17, isSoft: false });
  });

  it('two aces and a 5: hard 17', () => {
    // 1 + 1 + 5 = 7; promote one ace → 17 (still <=21), so soft 17.
    const detail = handTotalDetail([c('hearts', 'Ace'), c('spades', 'Ace'), c('clubs', '5')]);
    expect(detail).toEqual({ total: 17, isSoft: true });
  });

  it('bust totals report hard', () => {
    const detail = handTotalDetail([c('hearts', 'King'), c('spades', 'Queen'), c('clubs', '5')]);
    expect(detail).toEqual({ total: 25, isSoft: false });
  });
});

describe('isNaturalBlackjack', () => {
  it('returns true for a 2-card 21', () => {
    expect(isNaturalBlackjack([c('hearts', 'Ace'), c('spades', 'King')])).toBe(true);
  });

  it('returns false for 3-card 21', () => {
    expect(isNaturalBlackjack([c('hearts', '7'), c('spades', '7'), c('clubs', '7')])).toBe(false);
  });
});

describe('hasHiddenCard', () => {
  it('detects a hidden card', () => {
    expect(hasHiddenCard([c('hidden', 'hidden'), c('hearts', '5')])).toBe(true);
  });

  it('returns false when all cards are visible', () => {
    expect(hasHiddenCard([c('hearts', 'Ace'), c('spades', 'King')])).toBe(false);
  });
});
