import { describe, it, expect } from 'vitest';
import { runAiCascade } from './aiRunner';
import { fiveCardDrawEngine } from './poker/fiveCardDraw/engine';
import { blackjackEngine } from './blackjack/engine';
import { seededRng } from './rng';

const FIXED_RNG = seededRng(Array.from({ length: 200 }, () => 0));
const noopRng = () => seededRng([]);

describe('runAiCascade — 5-card draw, all players AI', () => {
  it('plays a hand to terminal when every seat is AI', () => {
    const state = fiveCardDrawEngine.initialState(
      { ante: 5, minBet: 10, stacks: { a: 1000, b: 1000, c: 1000 } },
      ['a', 'b', 'c'],
      FIXED_RNG,
    );
    const result = runAiCascade({
      engine: fiveCardDrawEngine,
      state,
      getCurrentActor: (s) => s.toAct,
      isAI: () => true,
      rng: noopRng(),
    });
    expect(result.reachedTerminal).toBe(true);
    expect(result.finalState.phase).toBe('settled');
    // Every step was an AI action; cascade should have taken at least 6
    // steps (3 actors × 2 betting rounds + 3 draws), often more if any
    // raises happen — but passive AI calls everything so we expect
    // exactly that count for the no-raise lane.
    expect(result.steps.length).toBeGreaterThanOrEqual(6);
  });
});

describe('runAiCascade — mixed humans and AI', () => {
  it('stops on a human turn and resumes after the human acts', () => {
    // Three seats: human=a, AI=b, AI=c. a checks (1st action), cascade
    // should immediately stop when toAct lands back on a.
    let state = fiveCardDrawEngine.initialState(
      { ante: 5, minBet: 10, stacks: { a: 1000, b: 1000, c: 1000 } },
      ['a', 'b', 'c'],
      FIXED_RNG,
    );
    const isAI = (id: string) => id !== 'a';

    // Human action 1: a checks.
    state = fiveCardDrawEngine.applyAction(state, 'a', { kind: 'check', playerId: 'a' }, noopRng());
    // Now toAct should be 'b' (AI). Cascade: b checks, c checks → round
    // closes → phase becomes 'draw' → toAct is 'a' again (first active).
    const result = runAiCascade({
      engine: fiveCardDrawEngine,
      state,
      getCurrentActor: (s) => s.toAct,
      isAI,
      rng: noopRng(),
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].slotId).toBe('b');
    expect(result.steps[1].slotId).toBe('c');
    expect(result.finalState.phase).toBe('draw');
    expect(result.finalState.toAct).toBe('a');
    expect(result.reachedTerminal).toBe(false);
  });
});

describe('runAiCascade — blackjack', () => {
  it('plays the AI seat through a hand from awaiting_bets to settled', () => {
    const state = blackjackEngine.initialState(
      { minimumBet: 5, maximumBet: 100, numDecks: 1, dealerHitsSoft17: false },
      ['ai-1'],
      FIXED_RNG,
    );
    // Need to fast-forward the engine through awaiting_bets → playing.
    // The AI cascade handles it: places bet, possibly hits/stays, dealer
    // plays out, lands at settled.
    const result = runAiCascade({
      engine: blackjackEngine,
      state,
      getCurrentActor: (s) => s.toAct,
      isAI: () => true,
      rng: noopRng(),
    });
    // The cascade ends when toAct goes null (dealer phase needs the
    // wrapper to drive `dealer_play`) or terminal is reached.
    expect(['settled', 'dealer']).toContain(result.finalState.phase);
    expect(result.steps.length).toBeGreaterThan(0);
  });
});

describe('runAiCascade — error paths', () => {
  it('throws if the engine has no aiAction', () => {
    const fakeEngine = {
      id: 'no-ai',
      initialState: () => ({}),
      legalActions: () => [],
      applyAction: () => ({}),
      viewFor: () => ({}),
      isTerminal: () => false,
      settle: () => [],
    } as unknown as Parameters<typeof runAiCascade>[0]['engine'];
    expect(() =>
      runAiCascade({
        engine: fakeEngine,
        state: {},
        getCurrentActor: () => 'x',
        isAI: () => true,
        rng: noopRng(),
      }),
    ).toThrow(/no aiAction/);
  });

  it('throws when maxSteps is exceeded', () => {
    const stallingEngine = {
      id: 'stall',
      initialState: () => ({}),
      legalActions: () => [],
      applyAction: (s: unknown) => s,
      viewFor: () => ({}),
      isTerminal: () => false,
      settle: () => [],
      aiAction: () => ({ kind: 'noop' }),
    } as unknown as Parameters<typeof runAiCascade>[0]['engine'];
    expect(() =>
      runAiCascade({
        engine: stallingEngine,
        state: {},
        getCurrentActor: () => 'x',
        isAI: () => true,
        rng: noopRng(),
        maxSteps: 3,
      }),
    ).toThrow(/maxSteps/);
  });
});
