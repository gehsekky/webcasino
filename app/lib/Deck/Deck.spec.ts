import { describe, it, expect } from 'vitest';
import Deck from './index';
import Card from '../Card';

const cardKey = (c: Card) => `${c.suit}-${c.rank}`;

describe('Deck construction', () => {
  it('contains 52 cards (4 suits x 13 ranks)', () => {
    const deck = new Deck();
    expect(deck.cards).toHaveLength(52);
  });

  it('contains every unique (suit, rank) combination', () => {
    const deck = new Deck();
    const keys = new Set(deck.cards.map(cardKey));
    expect(keys.size).toBe(52);
    for (const suit of Card.suits) {
      for (const rank of Card.ranks) {
        expect(keys.has(`${suit}-${rank}`)).toBe(true);
      }
    }
  });

  it('every card in the deck has a known suit and rank from the Card class', () => {
    const deck = new Deck();
    const suits = new Set(Card.suits);
    const ranks = new Set(Card.ranks);
    for (const card of deck.cards) {
      expect(suits.has(card.suit)).toBe(true);
      expect(ranks.has(card.rank)).toBe(true);
    }
  });
});

describe('Deck.shuffle', () => {
  it('preserves the multiset of cards', () => {
    const deck = new Deck();
    const before = deck.cards.map(cardKey).sort();
    deck.shuffle();
    const after = deck.cards.map(cardKey).sort();
    expect(after).toEqual(before);
  });

  it('changes the order at least sometimes (sanity check on Math.random)', () => {
    // Run 5 shuffles; require at least one differs from the original order.
    const original = new Deck().cards.map(cardKey);
    let anyDiffered = false;
    for (let i = 0; i < 5; i++) {
      const d = new Deck();
      d.shuffle();
      const reshuffled = d.cards.map(cardKey);
      if (reshuffled.some((k, idx) => k !== original[idx])) {
        anyDiffered = true;
        break;
      }
    }
    expect(anyDiffered).toBe(true);
  });
});

describe('Deck.createNewDeckFromCards', () => {
  it('uses the provided card array', () => {
    const cards = [new Card('hearts', '7'), new Card('spades', 'Ace')];
    const deck = Deck.createNewDeckFromCards(cards);
    expect(deck.cards).toEqual(cards);
  });
});
