import { describe, it, expect } from 'vitest';
import {
  CardSchema,
  BlackjackStateSchema,
  GamePlayerStateSchema,
  GameStateSchema,
  parseBlackjackState,
  parseGamePlayerState,
} from './gameState';

describe('CardSchema', () => {
  it('accepts a valid card', () => {
    expect(CardSchema.parse({ suit: 'hearts', rank: 'Ace' })).toEqual({ suit: 'hearts', rank: 'Ace' });
  });

  it('accepts hidden masking', () => {
    expect(() => CardSchema.parse({ suit: 'hidden', rank: 'hidden' })).not.toThrow();
  });

  it('rejects unknown suit', () => {
    expect(() => CardSchema.parse({ suit: 'stars', rank: 'Ace' })).toThrow();
  });

  it('rejects unknown rank', () => {
    expect(() => CardSchema.parse({ suit: 'hearts', rank: 'Joker' })).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() => CardSchema.parse({ suit: 'hearts' })).toThrow();
  });
});

describe('BlackjackStateSchema', () => {
  const valid = {
    type: 'blackjack' as const,
    minimumBet: 5,
    maximumBet: 100,
    deck: [{ suit: 'spades', rank: 'King' }],
    dealerHand: [],
    dealerCardsRevealed: false,
  };

  it('accepts a well-formed state', () => {
    expect(() => BlackjackStateSchema.parse(valid)).not.toThrow();
  });

  it('rejects wrong type literal', () => {
    expect(() => BlackjackStateSchema.parse({ ...valid, type: 'poker' })).toThrow();
  });

  it('rejects negative bet limits', () => {
    expect(() => BlackjackStateSchema.parse({ ...valid, minimumBet: -1 })).toThrow();
  });

  it('rejects non-integer bet limits', () => {
    expect(() => BlackjackStateSchema.parse({ ...valid, minimumBet: 1.5 })).toThrow();
  });

  it('rejects malformed card in deck', () => {
    expect(() =>
      BlackjackStateSchema.parse({ ...valid, deck: [{ suit: 'rainbow', rank: 'King' }] }),
    ).toThrow();
  });

  it('rejects null', () => {
    expect(() => parseBlackjackState(null)).toThrow();
  });
});

describe('GamePlayerStateSchema', () => {
  it('accepts an empty hand', () => {
    expect(() => GamePlayerStateSchema.parse({ cards: [] })).not.toThrow();
  });

  it('accepts a hand of valid cards', () => {
    expect(() =>
      GamePlayerStateSchema.parse({ cards: [{ suit: 'clubs', rank: '10' }] }),
    ).not.toThrow();
  });

  it('rejects missing cards field', () => {
    expect(() => parseGamePlayerState({})).toThrow();
  });

  it('rejects null', () => {
    expect(() => parseGamePlayerState(null)).toThrow();
  });
});

describe('GameStateSchema (discriminated union)', () => {
  it('narrows on the type literal', () => {
    const parsed = GameStateSchema.parse({
      type: 'blackjack',
      minimumBet: 5,
      maximumBet: 100,
      deck: [],
      dealerHand: [],
      dealerCardsRevealed: false,
    });
    expect(parsed.type).toBe('blackjack');
  });

  it('rejects an unknown discriminator', () => {
    expect(() => GameStateSchema.parse({ type: 'roulette' })).toThrow();
  });
});
