import type { GameEngine } from './types';
import { blackjackEngine } from './blackjack/engine';

/**
 * Engine registry. Add new entries here as new games are implemented.
 * The id used as the key must match what's stored in the `type` discriminator
 * of the game's persisted state.
 */
const engines: Record<string, GameEngine<unknown, unknown, unknown, unknown>> = {
  blackjack: blackjackEngine as GameEngine<unknown, unknown, unknown, unknown>,
};

export function engineById(id: string): GameEngine<unknown, unknown, unknown, unknown> | undefined {
  return engines[id];
}

export function registeredEngineIds(): string[] {
  return Object.keys(engines);
}
