import type { LoaderFunctionArgs } from '@remix-run/node';
import { requireUser } from 'auth/guards.server';
import { prisma } from 'db.server';
import { blackjackEngine } from 'engines/blackjack/engine';
import { fiveCardDrawEngine } from 'engines/poker/fiveCardDraw/engine';
import { BlackjackStateSchema, type BlackjackState } from 'lib/gameState';
import type { FiveCardDrawState } from 'engines/poker/fiveCardDraw/types';
import { broadcastBus, type BroadcastedHandEvent } from 'lib/broadcastBus.server';

/**
 * Room-level SSE stream. Forwards `state_update` events from the room's
 * currently-active hand (if any), projected through the right engine
 * for the viewer. Mid-hand joiners get the spectator projection — same
 * channel, masked private info.
 *
 * Lifecycle event support (hand_started / hand_ended / roster_changed)
 * is deferred — the room view route handles those transitions via a
 * loader refresh after the action that caused them.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const roomId = params.roomId;
  if (!roomId) {
    return new Response('roomId required', { status: 400 });
  }
  const user = await requireUser(request);

  const room = await prisma.casino_table.findUnique({
    where: { id: roomId },
    include: {
      seat: { select: { user_id: true } },
      hand: { orderBy: { created_at: 'desc' }, take: 1 },
    },
  });
  if (!room) {
    return new Response('room not found', { status: 404 });
  }

  const isMember = room.seat.some((s) => s.user_id === user.id);
  if (!isMember) {
    return new Response('not a member of this room', { status: 403 });
  }

  const latest = room.hand[0];
  const latestState = latest?.data as { phase?: string } | undefined;
  const handIsActive = !!latest && latestState?.phase !== 'settled';

  // Determine viewer's hand_seat for projection (null = spectator).
  let viewerHandSeatId: string | null = null;
  if (latest) {
    const hs = await prisma.hand_seat.findFirst({
      where: { hand_id: latest.id, user_id: user.id },
      select: { id: true },
    });
    viewerHandSeatId = hs?.id ?? null;
  }
  const projectionTarget: string = viewerHandSeatId ?? 'spectator';
  const gameType = room.game_type;

  const projectView = (state: unknown): unknown => {
    if (gameType === 'poker') {
      const s = state as FiveCardDrawState;
      return fiveCardDrawEngine.viewFor(s, projectionTarget);
    }
    const s = state as BlackjackState;
    return blackjackEngine.viewFor(s, projectionTarget);
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

      let unsubscribe: () => void = () => undefined;

      if (latest && handIsActive) {
        const handId = latest.id;

        // Subscribe before sending the snapshot so we don't miss anything
        // that lands between snapshot read and subscription.
        const buffered: BroadcastedHandEvent[] = [];
        let initialized = false;
        const emitEvent = (ev: BroadcastedHandEvent) => {
          const view = projectView(ev.state_after);
          send(
            'state_update',
            { sequence: ev.sequence, action: ev.action, actor: ev.actor_id, view },
            ev.sequence,
          );
        };
        unsubscribe = broadcastBus.subscribe(handId, (ev) => {
          if (!initialized) {
            buffered.push(ev);
            return;
          }
          emitEvent(ev);
        });

        // Initial snapshot from the persisted state.
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
        for (const ev of buffered) emitEvent(ev);
        buffered.length = 0;
      } else {
        // No active hand. Send an empty snapshot so the client knows the
        // initial connection succeeded; loader-side data is the source
        // of truth for the lobby view.
        send('snapshot', { view: null });
      }

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
