import { describe, it, expect } from 'vitest';
import { fiveCardDrawEngine } from './engine';
import { seededRng } from '../../rng';
import type { FiveCardDrawState, FiveCardDrawAction } from './types';
import type { CardData } from 'lib/gameState';

const PLAYERS = ['p1', 'p2', 'p3'];
const CONFIG = {
  ante: 5,
  minBet: 10,
  stacks: { p1: 1000, p2: 1000, p3: 1000 },
};

/**
 * A seeded RNG that picks index 0 on every Fisher-Yates step → fully
 * deterministic shuffle. The exact card order isn't important for these
 * tests; what matters is determinism.
 */
function detRng() {
  return seededRng(Array.from({ length: 60 }, () => 0));
}

function freshState(): FiveCardDrawState {
  return fiveCardDrawEngine.initialState(CONFIG, PLAYERS, detRng());
}

/** Engine.applyAction always takes an RNG per the GameEngine interface, but
 * 5-card draw's apply path doesn't use it. Wrap to keep the specs readable. */
const NOOP_RNG = seededRng([]);
function apply(s: FiveCardDrawState, who: string, action: FiveCardDrawAction): FiveCardDrawState {
  return fiveCardDrawEngine.applyAction(s, who, action, NOOP_RNG);
}

describe('fiveCardDrawEngine.initialState', () => {
  it('deals 5 cards to each of N ≥ 2 players', () => {
    const s = freshState();
    expect(s.players).toHaveLength(3);
    for (const p of s.players) {
      expect(p.cards).toHaveLength(5);
    }
    // 52 deck - 15 dealt = 37 remaining.
    expect(s.deck).toHaveLength(37);
  });

  it('debits the ante from each stack', () => {
    const s = freshState();
    for (const p of s.players) {
      expect(p.chips).toBe(1000 - 5);
      expect(p.totalBet).toBe(5);
      expect(p.status).toBe('active');
    }
  });

  it('starts in betting_1 with the first player to act', () => {
    const s = freshState();
    expect(s.phase).toBe('betting_1');
    expect(s.toAct).toBe('p1');
    expect(s.currentBet).toBe(0);
  });

  it('rejects fewer than 2 players', () => {
    expect(() =>
      fiveCardDrawEngine.initialState({ ante: 5, minBet: 10, stacks: { only: 100 } }, ['only'], detRng()),
    ).toThrow(/at least 2/);
  });

  it('rejects a player whose stack cannot cover the ante', () => {
    expect(() =>
      fiveCardDrawEngine.initialState(
        { ante: 10, minBet: 10, stacks: { p1: 100, p2: 5 } },
        ['p1', 'p2'],
        detRng(),
      ),
    ).toThrow(/cannot afford the ante/);
  });
});

describe('fiveCardDrawEngine — full hand played to showdown', () => {
  it('check-check-check → draw → check-check-check → showdown awards a single pot', () => {
    let s = freshState();
    // Round 1: everyone checks.
    s = apply(s, 'p1', { kind: 'check', playerId: 'p1' });
    s = apply(s, 'p2', { kind: 'check', playerId: 'p2' });
    s = apply(s, 'p3', { kind: 'check', playerId: 'p3' });
    expect(s.phase).toBe('draw');

    // Draw: everyone stands pat (discard 0).
    s = apply(s, 'p1', { kind: 'discard', playerId: 'p1', indices: [] });
    s = apply(s, 'p2', { kind: 'discard', playerId: 'p2', indices: [] });
    s = apply(s, 'p3', { kind: 'discard', playerId: 'p3', indices: [] });
    expect(s.phase).toBe('betting_2');

    // Round 2: everyone checks.
    s = apply(s, 'p1', { kind: 'check', playerId: 'p1' });
    s = apply(s, 'p2', { kind: 'check', playerId: 'p2' });
    s = apply(s, 'p3', { kind: 'check', playerId: 'p3' });
    expect(s.phase).toBe('settled');

    // Pot total = 3 × ante = 15. Sum of winnings should equal that.
    const totalWinnings = s.players.reduce((sum, p) => sum + p.winnings, 0);
    expect(totalWinnings).toBe(15);
    // Exactly one winner gets the whole pot (or the field is split in case of tie).
    expect(s.players.some((p) => p.winnings > 0)).toBe(true);
  });

  it('fold-fold → last player wins uncontested', () => {
    let s = freshState();
    s = apply(s, 'p1', { kind: 'check', playerId: 'p1' });
    s = apply(s, 'p2', { kind: 'bet', playerId: 'p2', amount: 50 });
    s = apply(s, 'p3', { kind: 'fold', playerId: 'p3' });
    s = apply(s, 'p1', { kind: 'fold', playerId: 'p1' });
    expect(s.phase).toBe('settled');
    // p2 wins uncontested. Pot was 3*ante (15) + p2's bet (50) = 65.
    // But only the matched portion counts as a pot at fold-down — actually
    // total contribution: p1=5, p2=55, p3=5 → sum = 65.
    const p2 = s.players.find((p) => p.id === 'p2')!;
    expect(p2.winnings).toBe(65);
  });

  it('discard 3 cards replaces 3 from the deck and leaves 5 in hand', () => {
    let s = freshState();
    const originalHand = [...s.players[0].cards];
    const originalDeckSize = s.deck.length;
    s = apply(s, 'p1', { kind: 'check', playerId: 'p1' });
    s = apply(s, 'p2', { kind: 'check', playerId: 'p2' });
    s = apply(s, 'p3', { kind: 'check', playerId: 'p3' });
    expect(s.phase).toBe('draw');

    s = apply(s, 'p1', { kind: 'discard', playerId: 'p1', indices: [0, 1, 2] });
    const newHand = s.players[0].cards;
    expect(newHand).toHaveLength(5);
    // The first three cards should now be different from the originals.
    // (Determinism guaranteed by seeded RNG.)
    expect(s.discardPile).toHaveLength(3);
    expect(s.deck.length).toBe(originalDeckSize - 3);
    // Sanity: original kept cards still present (indices 3, 4 of the original).
    expect(newHand).toContainEqual(originalHand[3]);
    expect(newHand).toContainEqual(originalHand[4]);
  });

  it('rejects discard with duplicate or out-of-range indices', () => {
    let s = freshState();
    s = apply(s, 'p1', { kind: 'check', playerId: 'p1' });
    s = apply(s, 'p2', { kind: 'check', playerId: 'p2' });
    s = apply(s, 'p3', { kind: 'check', playerId: 'p3' });
    expect(() =>
      apply(s, 'p1', { kind: 'discard', playerId: 'p1', indices: [0, 0] }),
    ).toThrow(/duplicate/);
    expect(() =>
      apply(s, 'p1', { kind: 'discard', playerId: 'p1', indices: [5] }),
    ).toThrow(/invalid discard index/);
  });
});

describe('fiveCardDrawEngine — betting mechanics', () => {
  it('bet → raise → call → call → draw → bet → call → call → showdown', () => {
    let s = freshState();
    s = apply(s, 'p1', { kind: 'bet', playerId: 'p1', amount: 10 });
    s = apply(s, 'p2', { kind: 'raise', playerId: 'p2', amount: 30 });
    s = apply(s, 'p3', { kind: 'call', playerId: 'p3' });
    s = apply(s, 'p1', { kind: 'call', playerId: 'p1' });
    expect(s.phase).toBe('draw');
    // After round 1: each contributed 30 + ante 5 = 35. Pot = 3*35 = 105.
    expect(s.players.every((p) => p.totalBet === 35)).toBe(true);
    expect(s.currentBet).toBe(0); // reset for next round

    // Draw stands pat for all.
    s = apply(s, 'p1', { kind: 'discard', playerId: 'p1', indices: [] });
    s = apply(s, 'p2', { kind: 'discard', playerId: 'p2', indices: [] });
    s = apply(s, 'p3', { kind: 'discard', playerId: 'p3', indices: [] });
    expect(s.phase).toBe('betting_2');

    s = apply(s, 'p1', { kind: 'bet', playerId: 'p1', amount: 20 });
    s = apply(s, 'p2', { kind: 'call', playerId: 'p2' });
    s = apply(s, 'p3', { kind: 'call', playerId: 'p3' });

    expect(s.phase).toBe('settled');
    const totalPot = s.players.reduce((sum, p) => sum + p.totalBet, 0);
    expect(totalPot).toBe(3 * 55); // 35 + 20 each
    const totalWinnings = s.players.reduce((sum, p) => sum + p.winnings, 0);
    expect(totalWinnings).toBe(totalPot);
  });

  it('rejects a check when there is a bet to call', () => {
    let s = freshState();
    s = apply(s, 'p1', { kind: 'bet', playerId: 'p1', amount: 10 });
    expect(() =>
      apply(s, 'p2', { kind: 'check', playerId: 'p2' }),
    ).toThrow(/check illegal/);
  });

  it('rejects a raise that does not meet the minimum increment', () => {
    let s = freshState();
    s = apply(s, 'p1', { kind: 'bet', playerId: 'p1', amount: 20 });
    // minRaise after a bet of 20 is 20 → raise target must be ≥ 40.
    expect(() =>
      apply(s, 'p2', { kind: 'raise', playerId: 'p2', amount: 30 }),
    ).toThrow(/below minimum/);
  });

  it('marks a player all_in when a call uses every chip', () => {
    const lowStack = {
      ante: 5,
      minBet: 10,
      stacks: { p1: 1000, p2: 25, p3: 1000 }, // p2 will be all-in after a 20 call (5 ante + 20 = 25 stack)
    };
    let s = fiveCardDrawEngine.initialState(lowStack, ['p1', 'p2', 'p3'], detRng());
    s = apply(s, 'p1', { kind: 'bet', playerId: 'p1', amount: 20 });
    s = apply(s, 'p2', { kind: 'call', playerId: 'p2' });
    const p2 = s.players.find((p) => p.id === 'p2')!;
    expect(p2.status).toBe('all_in');
    expect(p2.chips).toBe(0);
  });
});

describe('fiveCardDrawEngine.viewFor', () => {
  it('masks other players\' hole cards but shows the viewer\'s own', () => {
    const s = freshState();
    const v1 = fiveCardDrawEngine.viewFor(s, 'p1');
    const ownP1 = v1.players.find((p) => p.id === 'p1')!;
    const otherP2 = v1.players.find((p) => p.id === 'p2')!;
    expect(ownP1.cards.every((c) => c.suit !== 'hidden')).toBe(true);
    expect(otherP2.cards.every((c) => c.suit === 'hidden')).toBe(true);
  });

  it('reveals all hands once at showdown', () => {
    let s = freshState();
    s = apply(s, 'p1', { kind: 'check', playerId: 'p1' });
    s = apply(s, 'p2', { kind: 'check', playerId: 'p2' });
    s = apply(s, 'p3', { kind: 'check', playerId: 'p3' });
    s = apply(s, 'p1', { kind: 'discard', playerId: 'p1', indices: [] });
    s = apply(s, 'p2', { kind: 'discard', playerId: 'p2', indices: [] });
    s = apply(s, 'p3', { kind: 'discard', playerId: 'p3', indices: [] });
    s = apply(s, 'p1', { kind: 'check', playerId: 'p1' });
    s = apply(s, 'p2', { kind: 'check', playerId: 'p2' });
    s = apply(s, 'p3', { kind: 'check', playerId: 'p3' });
    expect(s.phase).toBe('settled');

    const view = fiveCardDrawEngine.viewFor(s, 'p1');
    for (const p of view.players) {
      expect(p.cards.every((c: CardData) => c.suit !== 'hidden')).toBe(true);
    }
  });

  it('emits a single placeholder action during the draw phase', () => {
    let s = freshState();
    s = apply(s, 'p1', { kind: 'check', playerId: 'p1' });
    s = apply(s, 'p2', { kind: 'check', playerId: 'p2' });
    s = apply(s, 'p3', { kind: 'check', playerId: 'p3' });
    expect(s.phase).toBe('draw');
    const view = fiveCardDrawEngine.viewFor(s, 'p1');
    expect(view.legalActions).toHaveLength(1);
    expect(view.legalActions[0].kind).toBe('discard');
  });
});
