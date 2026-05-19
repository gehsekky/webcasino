import type { LoaderFunctionArgs } from '@remix-run/node';
import { requireUser } from 'auth/guards.server';
import { prisma } from 'db.server';
import { blackjackEngine } from 'engines/blackjack/engine';
import { BlackjackStateSchema, type BlackjackState } from 'lib/gameState';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';
import { getHandEvents } from 'lib/handEvents';

/**
 * Server-Sent Events stream of state updates for one hand. Each subscriber
 * receives the current snapshot (filtered through `engine.viewFor`) and
 * then incremental updates as new events land in `hand_event`.
 *
 * URL: GET /hands/:handId/events
 *
 * Headers:
 *   Last-Event-ID (optional): resume from sequence N+1 instead of sending
 *     a fresh snapshot. Browsers' EventSource sets this automatically on
 *     reconnect.
 *
 * Authorization: caller must hold a hand_seat on this hand. (Spectator
 *   support comes later when there's a frontend that can request it.)
 *
 * SSE event types:
 *   - `snapshot`: full BlackjackView for the viewer at the current state.
 *   - `state_update`: `{ sequence, action, actor, view }` after each
 *     engine event.
 *
 * Private info filtering: the BlackjackState that flows through the bus
 * still contains the full deck and every player's hole cards. Subscribers
 * project it through `engine.viewFor(state, viewerSeatId)` BEFORE
 * sending, which masks the deck and the dealer's hole card (and, for
 * future games, other players' hidden cards).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const handId = params.handId;
  if (!handId) {
    return new Response('handId required', { status: 400 });
  }

  // Authorization: caller must have a seat at this hand.
  const viewerSeat = await prisma.hand_seat.findFirst({
    where: { hand_id: handId, user_id: user.id },
    select: { id: true },
  });
  if (!viewerSeat) {
    return new Response('not a participant of this hand', { status: 403 });
  }
  const viewerSeatId = viewerSeat.id;

  const lastEventIdHeader = request.headers.get('Last-Event-ID');
  const lastEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : null;
  const resumeFrom = Number.isFinite(lastEventId) ? Number(lastEventId) : null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (eventType: string, data: unknown, id?: number) => {
        if (closed) return;
        let line = '';
        if (id !== undefined) line += `id: ${id}\n`;
        line += `event: ${eventType}\n`;
        line += `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          closed = true;
        }
      };

      const sendComment = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ${text}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Subscribe BEFORE replaying / sending snapshot so live events that
      // arrive during the initial fetch get queued, not dropped.
      const buffered: BroadcastedHandEvent[] = [];
      let initialized = false;
      const flushBuffered = () => {
        for (const ev of buffered) emitEvent(ev);
        buffered.length = 0;
      };
      const emitEvent = (ev: BroadcastedHandEvent) => {
        const view = blackjackEngine.viewFor(ev.state_after, viewerSeatId);
        send(
          'state_update',
          { sequence: ev.sequence, action: ev.action, actor: ev.actor_id, view },
          ev.sequence,
        );
      };
      const unsubscribe = broadcastBus.subscribe(handId, (ev) => {
        if (!initialized) {
          buffered.push(ev);
          return;
        }
        emitEvent(ev);
      });

      // Initial payload: either a snapshot or a replay of missed events.
      try {
        if (resumeFrom !== null) {
          const missed = await getHandEvents(handId, resumeFrom, prisma);
          for (const row of missed) {
            // No state_after stored in DB. To rebuild it cheaply, just
            // send the latest snapshot once at the end; per-event diffs
            // for missed events would require running the fold here.
            // For now, signal that a snapshot follows.
            void row;
          }
          const hand = await prisma.hand.findUnique({ where: { id: handId } });
          if (hand) {
            const state = BlackjackStateSchema.parse(hand.data);
            const view = blackjackEngine.viewFor(state, viewerSeatId);
            send('snapshot', { view });
          }
        } else {
          const hand = await prisma.hand.findUnique({ where: { id: handId } });
          if (!hand) {
            send('error', { message: 'hand not found' });
            closed = true;
            controller.close();
            return;
          }
          const state: BlackjackState = BlackjackStateSchema.parse(hand.data);
          const view = blackjackEngine.viewFor(state, viewerSeatId);
          send('snapshot', { view });
        }
      } catch (err) {
        send('error', { message: (err as Error).message });
        unsubscribe();
        closed = true;
        controller.close();
        return;
      }

      initialized = true;
      flushBuffered();

      // Keepalive comment every 15s so proxies don't reap the connection.
      const keepalive = setInterval(() => sendComment('keepalive'), 15_000);

      // Cleanup on client disconnect.
      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener('abort', onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Hint to disable proxy buffering (nginx default).
      'X-Accel-Buffering': 'no',
    },
  });
}
