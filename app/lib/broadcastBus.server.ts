import type { BlackjackState } from 'lib/gameState';
import { EventBus } from 'lib/eventBus.server';

/**
 * Per-hand event broadcast. SSE subscribers register here; the engine
 * wrapper publishes after each transaction commits.
 *
 * Why post-commit publish: if we broadcast inside the prisma.$transaction
 * and the transaction rolls back, every subscriber sees a phantom event
 * that never landed in the source-of-truth log.
 */

export type BroadcastedHandEvent = {
  action: string;
  actor_id: string | null;
  payload: unknown;
  sequence: number;
  /** Engine state after this event was applied. Subscribers project via
   *  `engine.viewFor` for their viewer. Typed as BlackjackState but
   *  poker also flows through here with a wider state shape (cast at
   *  the publish site — to be tightened with a generic state union). */
  state_after: BlackjackState;
};

declare global {
  // eslint-disable-next-line no-var
  var __broadcastBus: EventBus<BroadcastedHandEvent> | undefined;
}

if (!globalThis.__broadcastBus) {
  globalThis.__broadcastBus = new EventBus<BroadcastedHandEvent>();
}

export const broadcastBus = globalThis.__broadcastBus;
