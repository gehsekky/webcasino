/**
 * Boot reconciliation for turn deadlines. Runs once at server startup
 * (called from `entry.server.ts`) and walks every unsettled hand whose
 * persisted state has a non-null `turnDeadlineAt`. Past-due deadlines
 * fire immediately; future ones get re-armed via the appropriate
 * engine's fire function.
 *
 * Without this, in-process timers don't survive a process restart and
 * a hand could sit forever waiting for a deadline that never re-fires.
 */

import { prisma } from 'db.server';
import { turnDeadlineService } from './turnDeadlineService.server';

type HandStateShape = {
  type?: string;
  phase?: string;
  toAct?: string | null;
  turnDeadlineAt?: string | null;
};

export async function reconcileTurnDeadlines(): Promise<void> {
  // Cheap query: latest hands across all rooms, filter in memory.
  // Volume here is bounded by # of in-flight hands, which is small.
  const candidates = await prisma.hand.findMany({
    select: { id: true, data: true },
  });

  let armed = 0;
  let fired = 0;
  for (const hand of candidates) {
    const s = hand.data as HandStateShape | null;
    if (!s) continue;
    if (s.phase === 'settled') continue;
    if (!s.toAct) continue;
    if (!s.turnDeadlineAt) continue;

    const deadline = new Date(s.turnDeadlineAt);
    if (Number.isNaN(deadline.getTime())) continue;

    // Lazily resolve the right fire function per game type — avoids a
    // top-level import cycle (engines/* → wrappers → this module).
    const fire = await resolveFireFn(s.type);
    if (!fire) continue;

    if (Date.now() >= deadline.getTime()) {
      // Past due. Fire on the next tick so reconcile finishes first
      // and we don't block startup behind a transaction.
      setImmediate(() => {
        void fire(hand.id).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`[turnDeadlineBoot] fire failed for ${hand.id}:`, err);
        });
      });
      fired += 1;
    } else {
      turnDeadlineService.arm(hand.id, deadline, () => fire(hand.id));
      armed += 1;
    }
  }

  if (armed > 0 || fired > 0) {
    // eslint-disable-next-line no-console
    console.log(`[turnDeadlineBoot] reconciled: armed=${armed} fired=${fired}`);
  }
}

async function resolveFireFn(
  stateType: string | undefined,
): Promise<((id: string) => Promise<void>) | null> {
  switch (stateType) {
    case 'blackjack': {
      const m = await import('../actions/handEngine.server');
      return m.fireBlackjackTurnTimeout;
    }
    case 'fivecarddraw': {
      const m = await import('../actions/pokerEngine.server');
      return m.firePokerTurnTimeout;
    }
    case 'holdem': {
      const m = await import('../actions/holdemEngine.server');
      return m.fireHoldemTurnTimeout;
    }
    // Slots / roulette: no turn-based timeouts.
    default:
      return null;
  }
}
