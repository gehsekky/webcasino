import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from 'db.server';
import { BlackjackStateSchema, type BlackjackState } from 'lib/gameState';
import { blackjackEngine } from 'engines/blackjack/engine';
import { defaultRng } from 'engines/rng';
import type { BlackjackAction } from 'engines/blackjack/types';

/**
 * Event-sourced history of a hand. Source of truth for audit, replay,
 * spectator subscriptions, and the real-time push transport (task #8).
 * The `hand.data` column is a cached snapshot kept in sync by the engine
 * wrapper; events are the immutable record.
 */

/** Sentinel for the bootstrap event that captures a hand's initial state. */
export const HAND_INITIALIZED = 'hand_initialized';

/**
 * A new event to append. The shape is intentionally engine-agnostic:
 * `action` is a string label, `payload` is JSON-serializable. Each
 * engine's wrapper attaches its own typed action payloads here.
 */
export type HandEventInput = {
  action: string;
  actorId: string | null;
  payload: unknown;
};

/** Shape of a row from the `hand_event` table for fold consumption. */
export type StoredHandEvent = {
  action: string;
  actor_id: string | null;
  payload: unknown;
};

/**
 * Append an event in the current transaction. Sequence is allocated as
 * `max(sequence)+1` for the hand; the `(hand_id, sequence)` primary-key
 * uniqueness catches any race. Returns the assigned sequence number.
 */
export async function appendHandEvent(
  handId: string,
  event: HandEventInput,
  tx: PrismaTransactionClient,
): Promise<number> {
  const last = await tx.hand_event.findFirst({
    where: { hand_id: handId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;

  await tx.hand_event.create({
    data: {
      hand_id: handId,
      sequence,
      actor_id: event.actorId,
      action: event.action,
      payload: event.payload as unknown as Prisma.JsonObject,
    },
  });

  return sequence;
}

/**
 * Read all events for a hand at or after `sinceSequence` (default 0 = all).
 * Used by replay, audit, and the planned SSE push transport (task #8).
 */
export async function getHandEvents(
  handId: string,
  sinceSequence: number,
  tx: PrismaTransactionClient,
): Promise<StoredHandEvent[]> {
  const rows = await tx.hand_event.findMany({
    where: { hand_id: handId, sequence: { gt: sinceSequence } },
    orderBy: { sequence: 'asc' },
    select: { action: true, actor_id: true, payload: true, sequence: true },
  });
  return rows;
}

/**
 * Pure fold over an event stream. Replays the events to reconstruct
 * state. The first event must be `hand_initialized`; subsequent events
 * are BlackjackAction payloads applied via the engine.
 */
export function foldHandEvents(events: StoredHandEvent[]): BlackjackState {
  if (events.length === 0) {
    throw new Error('foldHandEvents: empty event stream');
  }
  const first = events[0];
  if (first.action !== HAND_INITIALIZED) {
    throw new Error(
      `foldHandEvents: first event must be '${HAND_INITIALIZED}', got '${first.action}'`,
    );
  }
  const bootstrap = first.payload as { initialState: unknown };
  let state = BlackjackStateSchema.parse(bootstrap.initialState);

  for (let i = 1; i < events.length; i++) {
    const ev = events[i];
    const action = ev.payload as BlackjackAction;
    const actor = ev.actor_id ?? 'dealer';
    state = blackjackEngine.applyAction(state, actor, action, defaultRng);
  }
  return state;
}
