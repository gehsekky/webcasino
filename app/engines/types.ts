/**
 * Generic engine interface for any casino-style game. Each game type
 * (blackjack, poker, slots, ...) ships its own implementation. The action
 * layer dispatches by `engine.id`; the route layer is engine-agnostic.
 *
 * Engines are pure: all state changes flow through `applyAction`, which
 * takes the current state plus an action and returns the new state. Any
 * randomness comes via the injected `RNG` so behavior is testable and
 * (later, via CSPRNG + commit-reveal) auditable.
 */
export type EngineId = string;

export interface RNG {
  /** Returns an integer in [0, maxExclusive). */
  randInt(maxExclusive: number): number;
}

export type SettlementOrder = {
  playerId: string;
  /** Positive credits the player; negative debits. */
  delta: number;
  /** Human-readable reason ('win', 'lose', 'push', 'blackjack', 'surrender', etc.). */
  reason: string;
};

export interface GameEngine<State, Action, View, Config = unknown> {
  readonly id: EngineId;

  /** Construct the initial state for a new hand with the given seat holders. */
  initialState(config: Config, playerIds: string[], rng: RNG): State;

  /** Which actions are legal for `who` in the current state? */
  legalActions(state: State, who: string): Action[];

  /** Apply an action and return the new state. Throws on an illegal action. */
  applyAction(state: State, who: string, action: Action, rng: RNG): State;

  /**
   * Project state into a view for `viewer`. This is where private info
   * (deck, hidden cards, hole cards) gets masked. `'spectator'` means a
   * non-participant viewer.
   */
  viewFor(state: State, viewer: string | 'spectator'): View;

  /** Has the hand finished? */
  isTerminal(state: State): boolean;

  /** Chip movements once the hand ends. Caller applies these via the ledger. */
  settle(state: State): SettlementOrder[];

  /**
   * Pick a legal action on behalf of an AI-controlled seat. The wrapper
   * calls this whenever `state.toAct` resolves to a `user.is_ai = true`
   * account. Should be deterministic given (state, slotId); any
   * randomness (bluffing, variance) flows through `rng`.
   *
   * Optional — engines that don't implement it can only support
   * human-only seats (and the wrapper will surface a clear error if an
   * AI gets seated at such a game).
   */
  aiAction?(state: State, slotId: string, rng: RNG): Action;
}
