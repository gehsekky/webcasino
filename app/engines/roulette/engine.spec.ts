import { describe, it, expect } from 'vitest';
import { rouletteEngine } from './engine';
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

describe('roulette engine', () => {
  it('place_bet accumulates bets and totalStake', () => {
    const rng = fixedRng([0]);
    let state = rouletteEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    state = rouletteEngine.applyAction(
      state,
      'p',
      { kind: 'place_bet', playerId: 'p', bet: { kind: 'red', amount: 10 } },
      rng,
    );
    state = rouletteEngine.applyAction(
      state,
      'p',
      { kind: 'place_bet', playerId: 'p', bet: { kind: 'odd', amount: 5 } },
      rng,
    );
    expect(state.players[0].bets).toHaveLength(2);
    expect(state.players[0].totalStake).toBe(15);
    expect(state.phase).toBe('awaiting_bets');
  });

  it('straight bet on the winning number pays 35:1 + original stake', () => {
    // RNG seq: spin → 17 (% 37). Bet straight on 17.
    const rng = fixedRng([17]);
    let state = rouletteEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    state = rouletteEngine.applyAction(
      state,
      'p',
      { kind: 'place_bet', playerId: 'p', bet: { kind: 'straight', amount: 10, number: 17 } },
      rng,
    );
    state = rouletteEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p' }, rng);
    expect(state.result).toBe(17);
    expect(state.players[0].bets[0].payout).toBe(360); // 10 × 36 (stake + 35:1 winnings)
    expect(state.players[0].winnings).toBe(360);
    expect(state.phase).toBe('settled');
  });

  it('red bet wins when 0 hits → loses (0 is green)', () => {
    const rng = fixedRng([0]);
    let state = rouletteEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    state = rouletteEngine.applyAction(
      state,
      'p',
      { kind: 'place_bet', playerId: 'p', bet: { kind: 'red', amount: 10 } },
      rng,
    );
    state = rouletteEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p' }, rng);
    expect(state.result).toBe(0);
    expect(state.players[0].winnings).toBe(0);
  });

  it('low (1-18) wins on result 5', () => {
    const rng = fixedRng([5]);
    let state = rouletteEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    state = rouletteEngine.applyAction(
      state,
      'p',
      { kind: 'place_bet', playerId: 'p', bet: { kind: 'low', amount: 10 } },
      rng,
    );
    state = rouletteEngine.applyAction(state, 'p', { kind: 'spin', playerId: 'p' }, rng);
    expect(state.players[0].winnings).toBe(20); // 1:1 = stake + winnings
  });

  it('multi-player: each player resolves their own bets', () => {
    const rng = fixedRng([17]);
    let state = rouletteEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['a', 'b'], rng);
    state = rouletteEngine.applyAction(
      state,
      'a',
      { kind: 'place_bet', playerId: 'a', bet: { kind: 'straight', amount: 10, number: 17 } },
      rng,
    );
    state = rouletteEngine.applyAction(
      state,
      'b',
      { kind: 'place_bet', playerId: 'b', bet: { kind: 'red', amount: 5 } },
      rng,
    );
    state = rouletteEngine.applyAction(state, 'a', { kind: 'spin', playerId: 'a' }, rng);
    // 17 is black → b's red bet loses; a's straight wins big.
    expect(state.players.find((p) => p.id === 'a')!.winnings).toBe(360);
    expect(state.players.find((p) => p.id === 'b')!.winnings).toBe(0);
  });

  it('rejects straight bets without a number', () => {
    const rng = fixedRng([0]);
    const state = rouletteEngine.initialState({ minimumBet: 1, maximumBet: 100 }, ['p'], rng);
    expect(() =>
      rouletteEngine.applyAction(
        state,
        'p',
        { kind: 'place_bet', playerId: 'p', bet: { kind: 'straight', amount: 5 } },
        rng,
      ),
    ).toThrow();
  });
});
