import type { BlackjackState } from 'lib/gameState';

/**
 * Per-hand event broadcast. SSE subscribers register here; the engine
 * wrapper publishes after each transaction commits. Single-process
 * pub/sub — multi-instance deployments will need Postgres LISTEN/NOTIFY
 * (or a message bus) layered on top; the subscribe/publish interface
 * stays the same.
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
   *  `engine.viewFor` for their viewer. */
  state_after: BlackjackState;
};

type Subscriber = (event: BroadcastedHandEvent) => void;

class BroadcastBus {
  private subscribers = new Map<string, Set<Subscriber>>();

  subscribe(handId: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(handId);
    if (!set) {
      set = new Set();
      this.subscribers.set(handId, set);
    }
    set.add(fn);
    return () => {
      const s = this.subscribers.get(handId);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.subscribers.delete(handId);
      }
    };
  }

  publish(handId: string, event: BroadcastedHandEvent): void {
    const set = this.subscribers.get(handId);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try {
        fn(event);
      } catch (err) {
        // Don't let one bad subscriber kill the broadcast loop.
        // eslint-disable-next-line no-console
        console.error('[broadcastBus] subscriber threw:', err);
      }
    }
  }

  subscriberCount(handId: string): number {
    return this.subscribers.get(handId)?.size ?? 0;
  }

  /** Test-only: drop all subscribers across all hands. */
  reset(): void {
    this.subscribers.clear();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __broadcastBus: BroadcastBus | undefined;
}

if (!globalThis.__broadcastBus) {
  globalThis.__broadcastBus = new BroadcastBus();
}

export const broadcastBus = globalThis.__broadcastBus;
