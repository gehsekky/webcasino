import type { GameEngine, RNG } from './types';

/**
 * AI cascade runner. After a human action lands the state in a position
 * where the next-to-act seat is an AI, the wrapper calls this to walk
 * the state forward until either:
 *   - the engine reaches a terminal state, or
 *   - the next-to-act seat is a human, or
 *   - there's no `toAct` (e.g. phase doesn't need a per-actor action;
 *     callers handle phase-level transitions like `dealer_play`).
 *
 * Engine-agnostic: it asks the engine `who is acting next?` (via a
 * caller-provided `getCurrentActor` function — engines model the "who"
 * differently, e.g. `state.toAct` vs `state.currentSeat`), then asks the
 * engine for its AI's pick via `engine.aiAction`. Each applied action is
 * recorded so the caller can broadcast / event-log them.
 *
 * Why a callback for `getCurrentActor`: not all engine States expose
 * `toAct` at exactly the same shape; the small ceremony of "tell me how
 * to read the next actor from this state" keeps the runner pure.
 *
 * Safety: bounded by `maxSteps` (default 64) to prevent runaway loops
 * if an AI strategy and an engine ever get out of sync.
 */

export type CascadeStep<Action> = {
  slotId: string;
  action: Action;
};

export type CascadeResult<State, Action> = {
  finalState: State;
  steps: CascadeStep<Action>[];
  /** True iff the cascade stopped because the engine reached terminal. */
  reachedTerminal: boolean;
};

export type AiCascadeOptions<State, Action> = {
  engine: GameEngine<State, Action, unknown, unknown>;
  state: State;
  /** Which seat is acting next? Return null when no one is. */
  getCurrentActor: (state: State) => string | null;
  /** True iff the given seat is AI-controlled. */
  isAI: (slotId: string) => boolean;
  rng: RNG;
  /** Defaults to 64 — generous safety bound. */
  maxSteps?: number;
};

export function runAiCascade<State, Action>(
  opts: AiCascadeOptions<State, Action>,
): CascadeResult<State, Action> {
  const { engine, isAI, rng, getCurrentActor } = opts;
  if (!engine.aiAction) {
    throw new Error(`runAiCascade: engine '${engine.id}' has no aiAction implementation`);
  }
  const maxSteps = opts.maxSteps ?? 64;

  let state = opts.state;
  const steps: CascadeStep<Action>[] = [];

  for (let i = 0; i < maxSteps; i++) {
    if (engine.isTerminal(state)) {
      return { finalState: state, steps, reachedTerminal: true };
    }
    const actor = getCurrentActor(state);
    if (actor === null) {
      // No one to act — caller drives the phase transition (e.g.
      // dealer_play in blackjack).
      return { finalState: state, steps, reachedTerminal: false };
    }
    if (!isAI(actor)) {
      // Hand back control to the human.
      return { finalState: state, steps, reachedTerminal: false };
    }
    const action = engine.aiAction(state, actor, rng);
    state = engine.applyAction(state, actor, action, rng);
    steps.push({ slotId: actor, action });
  }

  throw new Error(`runAiCascade: exceeded maxSteps=${maxSteps} — possible engine/strategy stall`);
}
