import { describe, it, expect } from 'vitest';
import { bestHandFrom } from './bestHandFrom';
import type { CardData } from 'lib/gameState';

const c = (suit: CardData['suit'], rank: CardData['rank']): CardData => ({ suit, rank });

function hand(notation: string): CardData[] {
  return notation.trim().split(/\s+/).map((token) => {
    const suit = (() => {
      switch (token.slice(-1)) {
        case 'h': return 'hearts' as const;
        case 'd': return 'diamonds' as const;
        case 's': return 'spades' as const;
        case 'c': return 'clubs' as const;
        default: throw new Error(`bad suit in ${token}`);
      }
    })();
    const rankPart = token.slice(0, -1);
    const rank = (() => {
      switch (rankPart) {
        case 'A': return 'Ace' as const;
        case 'K': return 'King' as const;
        case 'Q': return 'Queen' as const;
        case 'J': return 'Jack' as const;
        case '10': return '10' as const;
        default: return rankPart as CardData['rank'];
      }
    })();
    return c(suit, rank);
  });
}

describe('bestHandFrom', () => {
  it('with exactly 5 cards returns evaluateHand', () => {
    const r = bestHandFrom(hand('Ah Ks Qd Jc 10h'));
    expect(r.category).toBe('straight');
    expect(r.tiebreakers[0]).toBe(14);
  });

  it('Hold\'em: 2 hole + 5 community → picks the flush', () => {
    // Hole: Ah 7h. Board: Kh Qh 3h 8d 2c. Best: A-K-Q-7-3 of hearts (flush).
    const r = bestHandFrom(hand('Ah 7h Kh Qh 3h 8d 2c'));
    expect(r.category).toBe('flush');
    expect(r.tiebreakers).toEqual([14, 13, 12, 7, 3]);
  });

  it('Hold\'em: picks straight when flush is unavailable', () => {
    // Hole: Ah Kd. Board: Qs Jc 10h 2d 5c. Best: A-K-Q-J-10 broadway.
    const r = bestHandFrom(hand('Ah Kd Qs Jc 10h 2d 5c'));
    expect(r.category).toBe('straight');
    expect(r.tiebreakers[0]).toBe(14);
  });

  it('Hold\'em: picks full house over trips', () => {
    // Hole: Kh Kd. Board: Ks 7c 7h 2d 5c. Best: KKK77 full house.
    const r = bestHandFrom(hand('Kh Kd Ks 7c 7h 2d 5c'));
    expect(r.category).toBe('full_house');
    expect(r.tiebreakers).toEqual([13, 7, 0, 0, 0]);
  });

  it('throws on fewer than 5 cards', () => {
    expect(() => bestHandFrom(hand('Ah Kd 7s'))).toThrow(/at least 5/);
  });
});
