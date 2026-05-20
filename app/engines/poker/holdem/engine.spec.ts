import { describe, it, expect } from 'vitest';
import { holdemEngine } from './engine';
import type { HoldemConfig, HoldemState } from './types';
import type { RNG } from '../../types';

/** Deterministic RNG: cycles through a list. */
function fixedRng(seed: number[]): RNG {
  let i = 0;
  return {
    randInt(maxExclusive: number) {
      const v = seed[i % seed.length] % maxExclusive;
      i += 1;
      return v;
    },
  };
}

function defaultConfig(ids: string[], chips = 1000): HoldemConfig {
  const stacks: Record<string, number> = {};
  for (const id of ids) stacks[id] = chips;
  return { smallBlind: 5, bigBlind: 10, stacks };
}

describe('holdem engine', () => {
  it('initial state posts blinds and is in preflop', () => {
    const ids = ['a', 'b', 'c'];
    const cfg = defaultConfig(ids);
    const state = holdemEngine.initialState(cfg, ids, fixedRng([1, 2, 3, 4]));

    expect(state.phase).toBe('preflop');
    // 3 players: dealer=0 (a), sb=1 (b), bb=2 (c), UTG (a) acts first.
    expect(state.toAct).toBe('a');
    expect(state.players[1].totalBet).toBe(5); // SB
    expect(state.players[2].totalBet).toBe(10); // BB
    expect(state.currentBet).toBe(10);
    expect(state.players.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(state.community.length).toBe(0);
  });

  it('heads-up: dealer acts first preflop, non-dealer acts first postflop', () => {
    const ids = ['a', 'b'];
    const cfg = defaultConfig(ids);
    let state = holdemEngine.initialState(cfg, ids, fixedRng([0]));

    // Heads-up: dealer=0=a is also the SB and acts first preflop.
    expect(state.toAct).toBe('a');
    expect(state.players[0].totalBet).toBe(5); // dealer/SB
    expect(state.players[1].totalBet).toBe(10); // BB

    // a calls to 10, then b checks → flop. Non-dealer (b) acts first.
    state = holdemEngine.applyAction(state, 'a', { kind: 'call', playerId: 'a' }, fixedRng([0]));
    expect(state.toAct).toBe('b');
    state = holdemEngine.applyAction(state, 'b', { kind: 'check', playerId: 'b' }, fixedRng([0]));
    expect(state.phase).toBe('flop');
    expect(state.community.length).toBe(3);
    expect(state.toAct).toBe('b');
  });

  it('fold-around in preflop awards uncontested pot to the last active player', () => {
    const ids = ['a', 'b', 'c'];
    const cfg = defaultConfig(ids);
    let state = holdemEngine.initialState(cfg, ids, fixedRng([0]));

    // a folds, b folds (calling out the dealer rotation: dealer=0, sb=1=b, bb=2=c).
    state = holdemEngine.applyAction(state, 'a', { kind: 'fold', playerId: 'a' }, fixedRng([0]));
    state = holdemEngine.applyAction(state, 'b', { kind: 'fold', playerId: 'b' }, fixedRng([0]));

    expect(state.phase).toBe('settled');
    // c (the BB) was the only active player left → wins the pot (SB + BB = 15).
    const c = state.players.find((p) => p.id === 'c')!;
    expect(c.winnings).toBe(15);
    expect(c.status).toBe('active');
  });

  it('full hand: 2 players, call-through to showdown deals all 5 community cards', () => {
    const ids = ['a', 'b'];
    const cfg = defaultConfig(ids);
    let state = holdemEngine.initialState(cfg, ids, fixedRng([0]));

    // Preflop: a calls, b checks. Flop dealt.
    state = step(state, 'a', { kind: 'call' });
    state = step(state, 'b', { kind: 'check' });
    expect(state.phase).toBe('flop');
    expect(state.community.length).toBe(3);

    // Flop: b checks (acts first postflop heads-up), a checks. Turn dealt.
    state = step(state, 'b', { kind: 'check' });
    state = step(state, 'a', { kind: 'check' });
    expect(state.phase).toBe('turn');
    expect(state.community.length).toBe(4);

    // Turn: same.
    state = step(state, 'b', { kind: 'check' });
    state = step(state, 'a', { kind: 'check' });
    expect(state.phase).toBe('river');
    expect(state.community.length).toBe(5);

    // River: same. Showdown auto-runs.
    state = step(state, 'b', { kind: 'check' });
    state = step(state, 'a', { kind: 'check' });
    expect(state.phase).toBe('settled');

    // Each non-folded player should have a hand rank evaluated.
    expect(state.players.every((p) => p.rank !== null)).toBe(true);

    // Total winnings should equal the pot (both players each bet 10).
    const totalIn = state.players.reduce((s, p) => s + p.totalBet, 0);
    const totalWinnings = state.players.reduce((s, p) => s + p.winnings, 0);
    expect(totalWinnings).toBe(totalIn);
  });

  it('legal actions exclude bet/raise when chips are zero', () => {
    const ids = ['a', 'b'];
    const cfg: HoldemConfig = { smallBlind: 5, bigBlind: 10, stacks: { a: 10, b: 10 } };
    const state = holdemEngine.initialState(cfg, ids, fixedRng([0]));
    // Both players are heads-up. a (dealer/SB) has 5 chips left; b (BB) has 0.
    const actsA = holdemEngine.legalActions(state, 'a');
    expect(actsA.some((act) => act.kind === 'fold')).toBe(true);
    // a owes 5 more to call → call is legal, raise needs more than owed.
    expect(actsA.some((act) => act.kind === 'call')).toBe(true);
  });

  it('viewFor masks opponent hole cards before showdown', () => {
    const ids = ['a', 'b'];
    const cfg = defaultConfig(ids);
    const state = holdemEngine.initialState(cfg, ids, fixedRng([0]));
    const view = holdemEngine.viewFor(state, 'a');
    const aSlot = view.players.find((p) => p.id === 'a')!;
    const bSlot = view.players.find((p) => p.id === 'b')!;
    expect(aSlot.cards.every((c) => c.suit !== 'hidden')).toBe(true);
    expect(bSlot.cards.every((c) => c.suit === 'hidden')).toBe(true);
  });
});

/** Test helper: apply an action by kind without manually setting playerId. */
function step(
  state: HoldemState,
  who: string,
  action: { kind: 'fold' | 'check' | 'call' } | { kind: 'bet' | 'raise'; amount: number },
): HoldemState {
  if (action.kind === 'bet' || action.kind === 'raise') {
    return holdemEngine.applyAction(
      state,
      who,
      { kind: action.kind, playerId: who, amount: action.amount },
      fixedRng([0]),
    );
  }
  return holdemEngine.applyAction(state, who, { kind: action.kind, playerId: who }, fixedRng([0]));
}
