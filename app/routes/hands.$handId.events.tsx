import type { LoaderFunctionArgs } from '@remix-run/node';
import { requireUser } from 'auth/guards.server';
import { prisma } from 'db.server';
import { blackjackEngine } from 'engines/blackjack/engine';
import { fiveCardDrawEngine } from 'engines/poker/fiveCardDraw/engine';
import { BlackjackStateSchema, type BlackjackState } from 'lib/gameState';
import type { FiveCardDrawState } from 'engines/poker/fiveCardDraw/types';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';

/**
 * Server-Sent Events stream of state updates for one hand. Each subscriber
 * receives the current snapshot (filtered through the appropriate
 * engine's `viewFor`) and then incremental updates as new events land.
 *
 * URL: GET /hands/:handId/events
 *
 * Dispatches by `casino_table.game_type` to the matching engine.
 *
 * Private info filtering: every broadcasted event carries the full
 * server state; we project it per-viewer here before sending so the
 * wire only carries what the viewer is allowed to see.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const handId = params.handId;
  if (!handId) {
    return new Response('handId required', { status: 400 });
  }

  const hand = await prisma.hand.findUnique({
    where: { id: handId },
    include: { casino_table: { select: { game_type: true } } },
  });
  if (!hand) {
    return new Response('hand not found', { status: 404 });
  }
  const gameType = hand.casino_table.game_type;

  // Authorization: caller must have a seat at this hand.
  const viewerSeat = await prisma.hand_seat.findFirst({
    where: { hand_id: handId, user_id: user.id },
    select: { id: true },
  });
  if (!viewerSeat) {
    return new Response('not a participant of this hand', { status: 403 });
  }
  const viewerSeatId = viewerSeat.id;

  const projectView = (state: unknown): unknown => {
    if (gameType === 'poker') {
      const s = state as FiveCardDrawState;
      return fiveCardDrawEngine.viewFor(s, viewerSeatId);
    }
    const s = state as BlackjackState;
    return blackjackEngine.viewFor(s, viewerSeatId);
  };

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

      const buffered: BroadcastedHandEvent[] = [];
      let initialized = false;
      const flushBuffered = () => {
        for (const ev of buffered) emitEvent(ev);
        buffered.length = 0;
      };
      const emitEvent = (ev: BroadcastedHandEvent) => {
        const view = projectView(ev.state_after);
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

      // Initial snapshot from the current persisted state.
      try {
        const handRow = await prisma.hand.findUnique({ where: { id: handId } });
        if (!handRow) {
          send('error', { message: 'hand not found' });
          closed = true;
          controller.close();
          return;
        }
        const state =
          gameType === 'poker'
            ? (handRow.data as unknown as FiveCardDrawState)
            : BlackjackStateSchema.parse(handRow.data);
        send('snapshot', { view: projectView(state) });
      } catch (err) {
        send('error', { message: (err as Error).message });
        unsubscribe();
        closed = true;
        controller.close();
        return;
      }

      initialized = true;
      flushBuffered();

      const keepalive = setInterval(() => sendComment('keepalive'), 15_000);

      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener('abort', onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
