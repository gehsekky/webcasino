import { describe, it, expect } from 'vitest';
import { evaluateHand } from './handEval';
import { compareHandRanks, type HandCategory } from './types';
import type { CardData } from 'lib/gameState';

const c = (suit: CardData['suit'], rank: CardData['rank']): CardData => ({ suit, rank });

/** Quick-build helper: parse strings like "Ah Kh Qh Jh 10h" into CardData[]. */
function hand(notation: string): CardData[] {
  return notation.trim().split(/\s+/).map((token) => {
    const suit = (() => {
      const s = token.slice(-1);
      switch (s) {
        case 'h': return 'hearts' as const;
        case 'd': return 'diamonds' as const;
        case 's': return 'spades' as const;
        case 'c': return 'clubs' as const;
        default: throw new Error(`hand: bad suit '${s}' in '${token}'`);
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

describe('evaluateHand — category detection', () => {
  const cases: Array<[string, string, HandCategory]> = [
    ['straight flush', 'Ah Kh Qh Jh 10h', 'straight_flush'],
    ['wheel straight flush', 'Ah 2h 3h 4h 5h', 'straight_flush'],
    ['four of a kind', 'Kh Kd Ks Kc 7d', 'four_of_a_kind'],
    ['full house (trips first)', 'Kh Kd Ks 7h 7d', 'full_house'],
    ['flush', 'Ah 10h 8h 5h 2h', 'flush'],
    ['straight', '9h 8d 7s 6c 5d', 'straight'],
    ['wheel straight', '5h 4d 3s 2c Ad', 'straight'],
    ['ace-high straight (broadway)', 'Ah Ks Qd Jc 10h', 'straight'],
    ['three of a kind', '7h 7d 7s Kh 4c', 'three_of_a_kind'],
    ['two pair', 'Kh Kd Qs Qc 7d', 'two_pair'],
    ['one pair', '7h 7d Ks Qh 4c', 'one_pair'],
    ['high card', 'Ah Kd 9s 5c 2d', 'high_card'],
  ];

  for (const [label, h, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(evaluateHand(hand(h)).category).toBe(expected);
    });
  }

  it('rejects hands that are not 5 cards', () => {
    expect(() => evaluateHand(hand('Ah Kh'))).toThrow(/5 cards/);
    expect(() => evaluateHand(hand('Ah Kh Qh Jh 10h 9h'))).toThrow(/5 cards/);
  });
});

describe('compareHandRanks — category order', () => {
  it('straight flush beats four of a kind', () => {
    const sf = evaluateHand(hand('5h 6h 7h 8h 9h'));
    const quads = evaluateHand(hand('Ah Ad As Ac Kd'));
    expect(compareHandRanks(sf, quads)).toBeGreaterThan(0);
  });

  it('full house beats flush', () => {
    const fh = evaluateHand(hand('7h 7d 7s 4h 4d'));
    const fl = evaluateHand(hand('Ah Qh 8h 5h 2h'));
    expect(compareHandRanks(fh, fl)).toBeGreaterThan(0);
  });

  it('straight beats three of a kind', () => {
    const st = evaluateHand(hand('5h 6d 7s 8c 9h'));
    const trips = evaluateHand(hand('Ah Ad As 5h 2c'));
    expect(compareHandRanks(st, trips)).toBeGreaterThan(0);
  });

  it('two pair beats one pair', () => {
    const tp = evaluateHand(hand('2h 2d 3s 3c Kh'));
    const op = evaluateHand(hand('Ah Ad Ks Qc 7h'));
    expect(compareHandRanks(tp, op)).toBeGreaterThan(0);
  });

  it('one pair beats high card', () => {
    const op = evaluateHand(hand('2h 2d 3s 4c 5h'));
    const hc = evaluateHand(hand('Ah Kd Qs Jc 9h'));
    expect(compareHandRanks(op, hc)).toBeGreaterThan(0);
  });
});

describe('compareHandRanks — same-category tiebreakers', () => {
  it('high pair beats low pair', () => {
    const kk = evaluateHand(hand('Kh Kd 7s 4c 2h'));
    const qq = evaluateHand(hand('Qh Qd Ks Jc 9h'));
    expect(compareHandRanks(kk, qq)).toBeGreaterThan(0);
  });

  it('same pair, higher kicker wins', () => {
    const a = evaluateHand(hand('Kh Kd Ah 4c 2h'));
    const b = evaluateHand(hand('Kh Kd Qh 4c 2h'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('two-pair: higher high-pair wins', () => {
    const a = evaluateHand(hand('Kh Kd 2s 2c 9h'));
    const b = evaluateHand(hand('Qh Qd Js Jc 9h'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('two-pair: same high pair, higher low pair wins', () => {
    const a = evaluateHand(hand('Kh Kd 5s 5c 9h'));
    const b = evaluateHand(hand('Kh Kd 3s 3c Ah'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('two-pair: same pairs, higher kicker wins', () => {
    const a = evaluateHand(hand('Kh Kd 5s 5c Ah'));
    const b = evaluateHand(hand('Kh Kd 5s 5c Qh'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('straight: ace-high broadway beats king-high', () => {
    const broadway = evaluateHand(hand('Ah Ks Qd Jc 10h'));
    const kingHigh = evaluateHand(hand('Kh Qs Jd 10c 9h'));
    expect(compareHandRanks(broadway, kingHigh)).toBeGreaterThan(0);
  });

  it('straight: wheel A-5 loses to 6-high', () => {
    const wheel = evaluateHand(hand('Ah 2d 3s 4c 5h'));
    const sixHigh = evaluateHand(hand('2h 3d 4s 5c 6h'));
    expect(compareHandRanks(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it('flush: higher top card wins', () => {
    const a = evaluateHand(hand('Ah 9h 7h 5h 2h'));
    const b = evaluateHand(hand('Kh Qh Jh 9h 3h'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('flush: same top, second card decides', () => {
    const a = evaluateHand(hand('Ah 10h 7h 5h 2h'));
    const b = evaluateHand(hand('Ah 9h 8h 6h 4h'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('full house: higher trips wins regardless of pair', () => {
    const a = evaluateHand(hand('Kh Kd Ks 2c 2h'));
    const b = evaluateHand(hand('Qh Qd Qs Ac Ah'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('full house: same trips, higher pair wins', () => {
    const a = evaluateHand(hand('Kh Kd Ks Ac Ah'));
    const b = evaluateHand(hand('Kh Kd Ks Qc Qh'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('quads: higher quad rank wins', () => {
    const a = evaluateHand(hand('Kh Kd Ks Kc 2h'));
    const b = evaluateHand(hand('Qh Qd Qs Qc Ah'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('quads: same quad rank, higher kicker wins (unusual at 5-card stud, possible with wild)', () => {
    const a = evaluateHand(hand('Kh Kd Ks Kc Ah'));
    const b = evaluateHand(hand('Kh Kd Ks Kc Qh'));
    expect(compareHandRanks(a, b)).toBeGreaterThan(0);
  });

  it('straight flush: royal beats lower straight flush', () => {
    const royal = evaluateHand(hand('Ah Kh Qh Jh 10h'));
    const lower = evaluateHand(hand('Kh Qh Jh 10h 9h'));
    expect(compareHandRanks(royal, lower)).toBeGreaterThan(0);
  });

  it('returns 0 for identical hands (by rank, not suit)', () => {
    const a = evaluateHand(hand('Kh Qd 7s 4c 2h'));
    const b = evaluateHand(hand('Kc Qh 7d 4s 2d'));
    expect(compareHandRanks(a, b)).toBe(0);
  });
});

describe('evaluateHand — pin specific tiebreakers', () => {
  it('two pair K-K-Q-Q-7 produces [13,12,7,0,0]', () => {
    const r = evaluateHand(hand('Kh Kd Qs Qc 7d'));
    expect(r.tiebreakers).toEqual([13, 12, 7, 0, 0]);
  });

  it('wheel straight tiebreaker is [5,0,0,0,0]', () => {
    const r = evaluateHand(hand('Ah 2d 3s 4c 5h'));
    expect(r.category).toBe('straight');
    expect(r.tiebreakers).toEqual([5, 0, 0, 0, 0]);
  });

  it('A-high flush tiebreakers descend', () => {
    const r = evaluateHand(hand('Ah Qh 9h 5h 2h'));
    expect(r.tiebreakers).toEqual([14, 12, 9, 5, 2]);
  });
});
