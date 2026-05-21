/**
 * In-process turn-deadline scheduler. Holds a `setTimeout` per active
 * hand and fires the registered `onFire` callback when the deadline
 * elapses. The actual server-side action (re-read state, apply auto-
 * action, broadcast) lives in the game engine wrappers — this module
 * only owns timing + cancellation.
 *
 * Single-process by design. Multi-instance deployments will need a
 * shared scheduler (advisory lock on fire, or move to a DB-backed
 * job table polled by a worker). The on-disk surface (state.turnDeadlineAt
 * persisted to hand.data) is what makes that future migration possible.
 */

type FireFn = () => Promise<void> | void;

declare global {
  // eslint-disable-next-line no-var
  var __turnDeadlineService: TurnDeadlineService | undefined;
}

class TurnDeadlineService {
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * Schedule a fire for `handId` at `deadlineAt`. Cancels any existing
   * timer for the same hand first. If `deadlineAt` is already past,
   * fires immediately on the next tick. The `onFire` callback is
   * responsible for re-reading state and verifying the deadline still
   * applies before applying any action (a real action may have landed
   * between scheduling and firing).
   */
  arm(handId: string, deadlineAt: Date, onFire: FireFn): void {
    this.cancel(handId);
    const ms = Math.max(0, deadlineAt.getTime() - Date.now());
    const handle = setTimeout(() => {
      this.timers.delete(handId);
      void Promise.resolve(onFire()).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[turnDeadlineService] onFire threw for hand ${handId}:`, err);
      });
    }, ms);
    this.timers.set(handId, handle);
  }

  cancel(handId: string): void {
    const existing = this.timers.get(handId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(handId);
    }
  }

  /** Test-only / shutdown helper. */
  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Diagnostics — how many timers are currently armed. */
  size(): number {
    return this.timers.size;
  }
}

if (!globalThis.__turnDeadlineService) {
  globalThis.__turnDeadlineService = new TurnDeadlineService();
}

export const turnDeadlineService = globalThis.__turnDeadlineService;

/**
 * Default human turn duration. 30s is long enough to think, short
 * enough to avoid griefing. Make per-room when someone asks.
 */
export const TURN_DURATION_MS = 30_000;

/**
 * Compute the next deadline for a turn that just landed on a player.
 * Returns `null` when no one is on the clock (round closed or AI seat).
 *
 * Centralized here so every engine wrapper has the same policy.
 */
export function computeTurnDeadline(params: {
  toAct: string | null;
  isHuman: (slotId: string) => boolean;
}): string | null {
  if (params.toAct === null) return null;
  if (!params.isHuman(params.toAct)) return null;
  return new Date(Date.now() + TURN_DURATION_MS).toISOString();
}

/**
 * Hash a UUID string into a 64-bit signed integer for use as a
 * Postgres advisory-lock key. Truncates to the first 64 bits of the
 * UUID hex; collisions across unrelated hands are possible but
 * harmless (just over-serialize two unrelated transactions).
 *
 * Returns a string so the caller can interpolate into a raw SQL
 * statement without bigint-binding fuss.
 */
export function handAdvisoryLockKey(handId: string): bigint {
  const hex = handId.replace(/-/g, '').slice(0, 16);
  // bigint cast: top bit may set the sign, that's fine — Postgres
  // pg_advisory_xact_lock takes a signed bigint.
  return BigInt.asIntN(64, BigInt(`0x${hex}`));
}
