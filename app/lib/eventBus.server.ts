/**
 * Generic in-process pub/sub. Used for both hand events (per-handId) and
 * chat messages (per-roomId). Single-process by design — multi-instance
 * deployments will need Postgres LISTEN/NOTIFY or a real broker layered
 * underneath, but the subscribe/publish interface stays the same.
 */

export class EventBus<T> {
  private subscribers = new Map<string, Set<(event: T) => void>>();

  subscribe(key: string, fn: (event: T) => void): () => void {
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(fn);
    return () => {
      const s = this.subscribers.get(key);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.subscribers.delete(key);
      }
    };
  }

  publish(key: string, event: T): void {
    const set = this.subscribers.get(key);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try {
        fn(event);
      } catch (err) {
        // Don't let one bad subscriber kill the broadcast loop.
        // eslint-disable-next-line no-console
        console.error('[eventBus] subscriber threw:', err);
      }
    }
  }

  subscriberCount(key: string): number {
    return this.subscribers.get(key)?.size ?? 0;
  }

  /** Test-only: drop all subscribers across all keys. */
  reset(): void {
    this.subscribers.clear();
  }
}
