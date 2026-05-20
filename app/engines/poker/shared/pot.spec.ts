import { describe, it, expect } from 'vitest';
import { buildPots, distributePots, type PotContribution } from './pot';
import { evaluateHand } from './handEval';
import type { HandRank } from './types';
import type { CardData } from 'lib/gameState';

const c = (suit: CardData['suit'], rank: CardData['rank']): CardData => ({ suit, rank });

function hand(notation: string): CardData[] {
  return notation
    .trim()
    .split(/\s+/)
    .map((token) => {
      const suit = (() => {
        switch (token.slice(-1)) {
          case 'h':
            return 'hearts' as const;
          case 'd':
            return 'diamonds' as const;
          case 's':
            return 'spades' as const;
          case 'c':
            return 'clubs' as const;
          default:
            throw new Error(`bad suit in ${token}`);
        }
      })();
      const rankPart = token.slice(0, -1);
      const rank = (() => {
        switch (rankPart) {
          case 'A':
            return 'Ace' as const;
          case 'K':
            return 'King' as const;
          case 'Q':
            return 'Queen' as const;
          case 'J':
            return 'Jack' as const;
          case '10':
            return '10' as const;
          default:
            return rankPart as CardData['rank'];
        }
      })();
      return c(suit, rank);
    });
}

describe('buildPots', () => {
  it('one pot when everyone bets equally', () => {
    const contributions: PotContribution[] = [
      { id: 'a', totalBet: 50, folded: false },
      { id: 'b', totalBet: 50, folded: false },
      { id: 'c', totalBet: 50, folded: false },
    ];
    const pots = buildPots(contributions);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(150);
    expect(pots[0].eligible.sort()).toEqual(['a', 'b', 'c']);
  });

  it('folded contributors still funnel chips but lose eligibility', () => {
    const contributions: PotContribution[] = [
      { id: 'a', totalBet: 50, folded: false },
      { id: 'b', totalBet: 50, folded: true },
      { id: 'c', totalBet: 50, folded: false },
    ];
    const pots = buildPots(contributions);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(150);
    expect(pots[0].eligible.sort()).toEqual(['a', 'c']);
  });

  it('all-in below the highest bet creates a side pot', () => {
    // A all-in at 20, B and C bet 50 each, none folded.
    const contributions: PotContribution[] = [
      { id: 'a', totalBet: 20, folded: false },
      { id: 'b', totalBet: 50, folded: false },
      { id: 'c', totalBet: 50, folded: false },
    ];
    const pots = buildPots(contributions);
    expect(pots).toHaveLength(2);
    // Main pot: 20 * 3 = 60, eligible A, B, C
    expect(pots[0].amount).toBe(60);
    expect(pots[0].eligible.sort()).toEqual(['a', 'b', 'c']);
    // Side pot: (50-20) * 2 = 60, eligible B, C only
    expect(pots[1].amount).toBe(60);
    expect(pots[1].eligible.sort()).toEqual(['b', 'c']);
  });

  it('three layers from two all-ins of different stacks', () => {
    const contributions: PotContribution[] = [
      { id: 'a', totalBet: 10, folded: false }, // all-in at 10
      { id: 'b', totalBet: 30, folded: false }, // all-in at 30
      { id: 'c', totalBet: 80, folded: false },
      { id: 'd', totalBet: 80, folded: false },
    ];
    const pots = buildPots(contributions);
    expect(pots).toHaveLength(3);
    // Layer 10: 10 * 4 = 40, all eligible
    expect(pots[0]).toEqual({ amount: 40, eligible: ['a', 'b', 'c', 'd'] });
    // Layer 30: (30-10) * 3 = 60, eligible b,c,d
    expect(pots[1]).toEqual({ amount: 60, eligible: ['b', 'c', 'd'] });
    // Layer 80: (80-30) * 2 = 100, eligible c,d
    expect(pots[2]).toEqual({ amount: 100, eligible: ['c', 'd'] });
  });

  it('returns empty when no one contributed', () => {
    expect(buildPots([])).toEqual([]);
    expect(buildPots([{ id: 'a', totalBet: 0, folded: false }])).toEqual([]);
  });
});

describe('distributePots', () => {
  it('single pot, single winner', () => {
    const aRank = evaluateHand(hand('Kh Kd Qs Qc 7d')); // two pair
    const bRank = evaluateHand(hand('Ah Kd 9s 4c 2h')); // high card
    const ranks = new Map<string, HandRank>([
      ['a', aRank],
      ['b', bRank],
    ]);
    const pots = [{ amount: 100, eligible: ['a', 'b'] }];
    const awards = distributePots(pots, ranks, ['a', 'b']);
    expect(awards).toEqual([{ potIndex: 0, id: 'a', amount: 100, rank: aRank }]);
  });

  it('tie splits evenly', () => {
    const r = evaluateHand(hand('Kh Kd Qs Qc 7d'));
    const ranks = new Map<string, HandRank>([
      ['a', r],
      ['b', r],
    ]);
    const pots = [{ amount: 100, eligible: ['a', 'b'] }];
    const awards = distributePots(pots, ranks, ['a', 'b']);
    expect(awards).toHaveLength(2);
    expect(awards[0].amount + awards[1].amount).toBe(100);
    expect(awards[0].amount).toBe(50);
    expect(awards[1].amount).toBe(50);
  });

  it('odd-chip remainder goes to first in seat order', () => {
    const r = evaluateHand(hand('Kh Kd Qs Qc 7d'));
    const ranks = new Map<string, HandRank>([
      ['a', r],
      ['b', r],
    ]);
    const pots = [{ amount: 101, eligible: ['a', 'b'] }];
    const awards = distributePots(pots, ranks, ['a', 'b']);
    expect(awards[0]).toMatchObject({ id: 'a', amount: 51 });
    expect(awards[1]).toMatchObject({ id: 'b', amount: 50 });
  });

  it('side pot exclusion: short stack wins main but not side', () => {
    // A all-in at 20 with quads. B and C bet 50, with pair vs straight.
    const quads = evaluateHand(hand('Ah Ad As Ac 2h'));
    const pair = evaluateHand(hand('Kh Kd Qs Jc 9h'));
    const straight = evaluateHand(hand('5h 6d 7s 8c 9h'));
    const ranks = new Map<string, HandRank>([
      ['a', quads],
      ['b', pair],
      ['c', straight],
    ]);
    const pots = buildPots([
      { id: 'a', totalBet: 20, folded: false },
      { id: 'b', totalBet: 50, folded: false },
      { id: 'c', totalBet: 50, folded: false },
    ]);
    const awards = distributePots(pots, ranks, ['a', 'b', 'c']);
    // Main pot (60) → a (quads beats everyone eligible).
    const main = awards.find((aw) => aw.potIndex === 0);
    expect(main).toMatchObject({ id: 'a', amount: 60 });
    // Side pot (60) → c (straight beats pair; a wasn't eligible).
    const side = awards.find((aw) => aw.potIndex === 1);
    expect(side).toMatchObject({ id: 'c', amount: 60 });
  });

  it('uncontested pot (everyone but one folded) goes to the lone eligible', () => {
    // Edge case: pot built from contributions where all others folded.
    const ranks = new Map<string, HandRank>([['a', evaluateHand(hand('Ah Ad As Ac 2h'))]]);
    const pots = [{ amount: 30, eligible: ['a'] }];
    const awards = distributePots(pots, ranks, ['a']);
    expect(awards).toEqual([{ potIndex: 0, id: 'a', amount: 30, rank: ranks.get('a') }]);
  });
});
