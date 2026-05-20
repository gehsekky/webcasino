import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Card from './index';

const RANKS = Card.ranks;
const SUITS = Card.suits;

const cardArb = fc
  .record({
    suit: fc.constantFrom(...SUITS),
    rank: fc.constantFrom(...RANKS),
  })
  .map(({ suit, rank }) => new Card(suit, rank));

describe('Card.getTotal', () => {
  it('sums numeric cards', () => {
    const hand = [new Card('hearts', '2'), new Card('spades', '5'), new Card('clubs', '9')];
    expect(Card.getTotal(hand)).toBe(16);
  });

  it('counts "10" as ten', () => {
    expect(Card.getTotal([new Card('hearts', '10')])).toBe(10);
    expect(Card.getTotal([new Card('hearts', '10'), new Card('spades', 'Ace')])).toBe(21);
  });

  it('counts face cards as 10', () => {
    const hand = [
      new Card('hearts', 'Jack'),
      new Card('spades', 'Queen'),
      new Card('clubs', 'King'),
    ];
    expect(Card.getTotal(hand)).toBe(30);
  });

  it('Ace alone counts as 11', () => {
    expect(Card.getTotal([new Card('hearts', 'Ace')])).toBe(11);
  });

  it('Ace + 10-value = 21 (natural blackjack)', () => {
    expect(Card.getTotal([new Card('hearts', 'Ace'), new Card('spades', 'King')])).toBe(21);
  });

  it('Ace soft-demotes to 1 to avoid bust', () => {
    // Ace + 8 + 5 = 24 → demote → 14
    const hand = [new Card('hearts', 'Ace'), new Card('spades', '8'), new Card('clubs', '5')];
    expect(Card.getTotal(hand)).toBe(14);
  });

  it('Two aces = 12 (one as 11, one as 1)', () => {
    expect(Card.getTotal([new Card('hearts', 'Ace'), new Card('spades', 'Ace')])).toBe(12);
  });

  it('Hidden cards contribute 0', () => {
    const hand = [new Card('hidden', 'hidden'), new Card('hearts', '7')];
    expect(Card.getTotal(hand)).toBe(7);
  });

  it('throws on unrecognized rank', () => {
    // Construct a malformed card by bypassing the strict types — `getTotal`
    // is the runtime guard, not the type system.
    const bogus = { suit: 'hearts', rank: 'Joker' } as unknown as Card;
    expect(() => Card.getTotal([bogus])).toThrow();
  });

  it('property: a hand of all-numeric cards equals the sum of their ranks', () => {
    const numericRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;
    const numericCardArb = fc
      .record({
        suit: fc.constantFrom(...SUITS),
        rank: fc.constantFrom(...numericRanks),
      })
      .map(({ suit, rank }) => new Card(suit, rank));

    fc.assert(
      fc.property(fc.array(numericCardArb, { minLength: 1, maxLength: 5 }), (hand) => {
        const expected = hand.reduce((s, c) => s + parseInt(c.rank, 10), 0);
        expect(Card.getTotal(hand)).toBe(expected);
      }),
    );
  });
});

describe('Card.has21', () => {
  it('returns true for exactly 21', () => {
    expect(Card.has21([new Card('hearts', 'Ace'), new Card('spades', 'King')])).toBe(true);
  });

  it('returns false for anything else', () => {
    expect(Card.has21([new Card('hearts', '5'), new Card('spades', '5')])).toBe(false);
    expect(
      Card.has21([new Card('hearts', 'King'), new Card('spades', 'King'), new Card('clubs', '5')]),
    ).toBe(false);
  });
});

describe('Card.isBust', () => {
  it('returns true above 21', () => {
    const hand = [new Card('hearts', 'King'), new Card('spades', 'Queen'), new Card('clubs', '5')];
    expect(Card.isBust(hand)).toBe(true);
  });

  it('returns false at or below 21', () => {
    expect(Card.isBust([new Card('hearts', 'King'), new Card('spades', 'Ace')])).toBe(false);
    expect(Card.isBust([new Card('hearts', '5'), new Card('spades', '5')])).toBe(false);
  });

  it('property: isBust iff getTotal > 21', () => {
    fc.assert(
      fc.property(fc.array(cardArb, { minLength: 1, maxLength: 8 }), (hand) => {
        expect(Card.isBust(hand)).toBe(Card.getTotal(hand) > 21);
      }),
    );
  });
});
