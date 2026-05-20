import { describe, it, expect } from 'vitest';
import { slotsEngine } from './engine';
import type { RNG } from '../types';

function fixedRng(seq: number[]): RNG {
  let i = 0;
  return {
    randInt(maxExclusive: number) {
      const v = seq[i % seq.length] % maxExclusive;
      i += 1;
      return v;
    },
  };
}

describe('slots engine', () => {
  it('initialState rejects anything other than 1 player', () => {
    expect(() =>
      slotsEngine.initialState({ minimumBet: 1, maximumBet: 100 }, [], fixedRng([0])),
    ).toThrow();
    expect(() =>
      slotsEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['a', 'b'], fixedRng([0])),
    ).toThrow();
  });

  it('a spin with all-same reels pays the matching multiplier', () => {
    // SLOT_SYMBOLS = [cherry, lemon, bell, bar, seven]
    // randInt always returns 4 % 5 = 4 → 'seven'. Three sevens → 100x.
    const rng = fixedRng([4]);
    let state = slotsEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    state = slotsEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p', amount: 5 }, rng);
    expect(state.phase).toBe('settled');
    expect(state.players[0].reels).toEqual(['seven', 'seven', 'seven']);
    expect(state.players[0].winnings).toBe(500); // 5 × 100
    expect(state.players[0].payoutKind).toBe('three_seven');
  });

  it('two sevens (any positions) pays the consolation multiplier', () => {
    // sequence: 4, 0, 4 → seven, cherry, seven. Two sevens → 3x.
    const rng = fixedRng([4, 0, 4]);
    let state = slotsEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    state = slotsEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p', amount: 10 }, rng);
    expect(state.players[0].payoutKind).toBe('two_seven');
    expect(state.players[0].winnings).toBe(30);
  });

  it('a losing spin pays nothing and still settles', () => {
    // 0, 1, 2 → cherry, lemon, bell. No match.
    const rng = fixedRng([0, 1, 2]);
    let state = slotsEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    state = slotsEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p', amount: 7 }, rng);
    expect(state.players[0].payoutKind).toBe('lose');
    expect(state.players[0].winnings).toBe(0);
    expect(state.phase).toBe('settled');
  });

  it('rejects bets below minimum or above maximum', () => {
    const rng = fixedRng([0]);
    const state = slotsEngine.initialState({ minimumBet: 5, maximumBet: 50 }, ['p'], rng);
    expect(() =>
      slotsEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p', amount: 1 }, rng),
    ).toThrow();
    expect(() =>
      slotsEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p', amount: 100 }, rng),
    ).toThrow();
  });

  it('settle emits a single order with delta = winnings - stake', () => {
    const rng = fixedRng([0]); // 3 cherries → 2x
    let state = slotsEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    state = slotsEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p', amount: 10 }, rng);
    const orders = slotsEngine.settle(state);
    expect(orders).toHaveLength(1);
    expect(orders[0].delta).toBe(10); // 20 winnings - 10 stake
    expect(orders[0].reason).toBe('win');
  });
});
