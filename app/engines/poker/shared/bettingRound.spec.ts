import { describe, it, expect } from 'vitest';
import {
  startRound,
  applyBettingAction,
  legalActionsFor,
  isFoldedDown,
  roundPotContribution,
  type BettingActor,
} from './bettingRound';

const actor = (id: string, chips = 100): BettingActor => ({
  id,
  status: 'active',
  chips,
  currentBet: 0,
  totalBet: 0,
});

describe('startRound', () => {
  it('starts at the requested actor', () => {
    const r = startRound({ actors: [actor('a'), actor('b'), actor('c')], startingActorIdx: 1 });
    expect(r.toActIdx).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.currentBet).toBe(0);
  });

  it('completes immediately when only one active actor remains', () => {
    const a1 = { ...actor('a'), status: 'folded' as const };
    const a2 = actor('b');
    const a3 = { ...actor('c'), status: 'folded' as const };
    const r = startRound({ actors: [a1, a2, a3], startingActorIdx: 1 });
    expect(r.complete).toBe(true);
  });
});

describe('applyBettingAction — single-table flow', () => {
  it('check / check / check → round closes (3 actors, no bet)', () => {
    let r = startRound({ actors: [actor('a'), actor('b'), actor('c')], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'check' });
    expect(r.complete).toBe(false);
    expect(r.toActIdx).toBe(1);
    r = applyBettingAction(r, 'b', { kind: 'check' });
    expect(r.toActIdx).toBe(2);
    r = applyBettingAction(r, 'c', { kind: 'check' });
    expect(r.complete).toBe(true);
  });

  it('bet → call → call closes the round', () => {
    let r = startRound({ actors: [actor('a'), actor('b'), actor('c')], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    expect(r.currentBet).toBe(10);
    expect(r.lastAggressorIdx).toBe(0);
    r = applyBettingAction(r, 'b', { kind: 'call' });
    expect(r.actors[1].chips).toBe(90);
    r = applyBettingAction(r, 'c', { kind: 'call' });
    expect(r.complete).toBe(true);
    expect(r.actors.every((a) => a.currentBet === 10)).toBe(true);
  });

  it('bet → raise → call → call closes the round', () => {
    let r = startRound({ actors: [actor('a'), actor('b'), actor('c')], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    r = applyBettingAction(r, 'b', { kind: 'raise', amount: 30 });
    expect(r.currentBet).toBe(30);
    expect(r.minRaise).toBe(20);
    r = applyBettingAction(r, 'c', { kind: 'call' });
    expect(r.actors[2].chips).toBe(70);
    // Back to A — must call the raise (already bet 10, owes 20 more).
    r = applyBettingAction(r, 'a', { kind: 'call' });
    expect(r.actors[0].currentBet).toBe(30);
    expect(r.complete).toBe(true);
  });

  it('fold removes the actor and round closes when only one active left', () => {
    let r = startRound({ actors: [actor('a'), actor('b')], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    r = applyBettingAction(r, 'b', { kind: 'fold' });
    expect(r.complete).toBe(true);
    expect(isFoldedDown(r)).toBe(true);
  });

  it('rejects check when there is a bet to call', () => {
    let r = startRound({ actors: [actor('a'), actor('b')], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    expect(() => applyBettingAction(r, 'b', { kind: 'check' })).toThrow(/check/);
  });

  it('rejects call when nothing to call', () => {
    const r = startRound({ actors: [actor('a'), actor('b')], startingActorIdx: 0 });
    expect(() => applyBettingAction(r, 'a', { kind: 'call' })).toThrow(/nothing to call/);
  });

  it('rejects bet when a bet already exists', () => {
    let r = startRound({ actors: [actor('a'), actor('b')], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    expect(() => applyBettingAction(r, 'b', { kind: 'bet', amount: 20 })).toThrow(/raise/);
  });

  it('rejects undersized raise', () => {
    let r = startRound({ actors: [actor('a'), actor('b'), actor('c')], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    // minRaise after a bet of 10 is 10 → raise target must be ≥ 20.
    expect(() => applyBettingAction(r, 'b', { kind: 'raise', amount: 15 })).toThrow(
      /below minimum/,
    );
  });

  it('marks actor all_in when call uses every chip', () => {
    const a = { ...actor('a', 100), currentBet: 0 };
    const b = { ...actor('b', 5), currentBet: 0 };
    let r = startRound({ actors: [a, b], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    r = applyBettingAction(r, 'b', { kind: 'call' });
    expect(r.actors[1].status).toBe('all_in');
    expect(r.actors[1].chips).toBe(0);
    expect(r.actors[1].currentBet).toBe(5);
  });

  it('legalActionsFor returns the right set per situation', () => {
    let r = startRound({ actors: [actor('a'), actor('b')], startingActorIdx: 0 });
    // Pre-bet for the to-act actor.
    expect(legalActionsFor(r, 'a').sort()).toEqual(['bet', 'check', 'fold']);
    // Not your turn.
    expect(legalActionsFor(r, 'b')).toEqual([]);
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    // Now b faces a bet.
    expect(legalActionsFor(r, 'b').sort()).toEqual(['call', 'fold', 'raise']);
  });

  it("roundPotContribution sums everyone's currentBet", () => {
    let r = startRound({ actors: [actor('a'), actor('b'), actor('c')], startingActorIdx: 0 });
    r = applyBettingAction(r, 'a', { kind: 'bet', amount: 10 });
    r = applyBettingAction(r, 'b', { kind: 'call' });
    r = applyBettingAction(r, 'c', { kind: 'call' });
    expect(roundPotContribution(r)).toBe(30);
  });
});

describe("startRound with opening bet (e.g. Hold'em blinds)", () => {
  it('respects currentBet/minRaise passed in', () => {
    const sb = { ...actor('sb'), currentBet: 5, totalBet: 5, chips: 95 };
    const bb = { ...actor('bb'), currentBet: 10, totalBet: 10, chips: 90 };
    const utg = actor('utg');
    const r = startRound({
      actors: [sb, bb, utg],
      startingActorIdx: 2,
      currentBet: 10,
      minRaise: 10,
    });
    expect(r.currentBet).toBe(10);
    expect(r.minRaise).toBe(10);
    expect(r.toActIdx).toBe(2);
    // UTG can call $10 or raise to ≥ $20.
    expect(legalActionsFor(r, 'utg').sort()).toEqual(['call', 'fold', 'raise']);
  });
});
