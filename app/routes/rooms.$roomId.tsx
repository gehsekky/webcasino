import { type ActionFunctionArgs, type LoaderFunctionArgs, json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { prisma } from 'db.server';
import { requireUser } from 'auth/guards.server';
import { startHand } from 'actions/tableLifecycle.server';
import { submitAction, parseBlackjackActionFromForm } from 'actions/handEngine.server';
import { submitPokerAction, parsePokerActionFromForm } from 'actions/pokerEngine.server';
import { blackjackEngine } from 'engines/blackjack/engine';
import { fiveCardDrawEngine } from 'engines/poker/fiveCardDraw/engine';
import { BlackjackStateSchema } from 'lib/gameState';
import type { BlackjackView } from 'engines/blackjack/types';
import type { FiveCardDrawState, FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';
import SiteHeader from 'components/SiteHeader';
import RoomLobby from 'components/RoomLobby';
import HandView from 'components/HandView';
import PokerHandView from 'components/PokerHandView';

type RoomSeatSummary = {
  position: number;
  userId: string;
  name: string;
  isAi: boolean;
  isViewer: boolean;
  isCreator: boolean;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const roomId = params.roomId;
  if (!roomId) throw new Response('roomId required', { status: 400 });
  const user = await requireUser(request);

  const room = await prisma.casino_table.findUnique({
    where: { id: roomId },
    include: {
      seat: {
        orderBy: { position: 'asc' },
        include: { user: { select: { id: true, name: true, is_ai: true } } },
      },
      hand: {
        orderBy: { created_at: 'desc' },
        take: 1,
      },
    },
  });
  if (!room) throw new Response('room not found', { status: 404 });

  // Authorization: must have a seat at the room. Invitations are claimed
  // on the landing page, not here.
  const isSeated = room.seat.some((s) => s.user_id === user.id);
  if (!isSeated) {
    throw new Response('not a member of this room', { status: 403 });
  }

  const seats: RoomSeatSummary[] = room.seat.map((s) => ({
    position: s.position,
    userId: s.user_id,
    name: s.user.name,
    isAi: s.user.is_ai,
    isViewer: s.user_id === user.id,
    isCreator: s.user_id === room.created_by,
  }));

  const viewer = { id: user.id, name: user.name };

  // Active hand? Phase != 'settled' on the latest hand row.
  const latest = room.hand[0];
  const latestState = latest?.data as { phase?: string } | undefined;
  const isActive = !!latest && latestState?.phase !== 'settled';

  const roomSummary = {
    id: room.id,
    gameType: room.game_type,
    minimumBet: room.minimum_bet,
    maximumBet: room.maximum_bet,
    maxSeats: room.max_seats,
    joinToken: room.join_token,
    isCreator: room.created_by === user.id,
  };

  if (!latest || !isActive) {
    // Pre-hand or post-settle lobby view.
    return json({
      mode: 'lobby' as const,
      room: roomSummary,
      seats,
      viewer,
      // Show settled outcome too if the latest hand exists.
      lastHandSettled: !!latest,
    });
  }

  // A hand is in progress. Find the viewer's hand_seat (if any). When the
  // user joined the room mid-hand they have a seat but no hand_seat for
  // this round — they spectate.
  const viewerHandSeat = await prisma.hand_seat.findFirst({
    where: { hand_id: latest.id, user_id: user.id },
    select: { id: true },
  });
  const handSeatId = viewerHandSeat?.id ?? null;
  const projectionTarget = handSeatId ?? 'spectator';

  if (room.game_type === 'poker') {
    const state = latest.data as unknown as FiveCardDrawState;
    if (state?.type !== 'fivecarddraw') {
      throw new Error('rooms loader: corrupt poker state');
    }
    const view = fiveCardDrawEngine.viewFor(state, projectionTarget);
    return json({
      mode: 'hand_poker' as const,
      room: roomSummary,
      seats,
      viewer,
      handId: latest.id,
      handSeatId,
      view,
    });
  }

  const bjState = BlackjackStateSchema.parse(latest.data);
  const view: BlackjackView = blackjackEngine.viewFor(bjState, projectionTarget);
  // Look up balance for the BetForm.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { money: true },
  });
  return json({
    mode: 'hand_blackjack' as const,
    room: roomSummary,
    seats,
    viewer: { ...viewer, balance: dbUser?.money ?? 0 },
    handId: latest.id,
    handSeatId,
    view,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const roomId = params.roomId;
  if (!roomId) throw new Response('roomId required', { status: 400 });
  const user = await requireUser(request);

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString() ?? '';

  if (intent === 'start_hand') {
    await startHand({ roomId, startedBy: user });
    return redirect(`/rooms/${roomId}`);
  }

  // Otherwise treat as a game action: find the viewer's hand_seat in the
  // currently active hand and submit the action.
  const latest = await prisma.hand.findFirst({
    where: { table_id: roomId },
    orderBy: { created_at: 'desc' },
    include: { casino_table: { select: { game_type: true } } },
  });
  if (!latest) throw new Response('no hand at this room', { status: 400 });
  const state = latest.data as { phase?: string };
  if (state.phase === 'settled') {
    throw new Response('hand already settled', { status: 400 });
  }

  const handSeat = await prisma.hand_seat.findFirst({
    where: { hand_id: latest.id, user_id: user.id },
    select: { id: true },
  });
  if (!handSeat) {
    throw new Response('not a participant of the active hand', { status: 403 });
  }

  const submitValue = formData.get('submit')?.toString() ?? '';
  if (latest.casino_table.game_type === 'poker') {
    const parsed = parsePokerActionFromForm(submitValue, formData, handSeat.id);
    await submitPokerAction({ handSeatId: handSeat.id, action: parsed });
  } else {
    const parsed = parseBlackjackActionFromForm(submitValue, formData, handSeat.id);
    await submitAction({ handSeatId: handSeat.id, action: parsed });
  }

  return redirect(`/rooms/${roomId}`);
}

export default function RoomRoute() {
  const data = useLoaderData<typeof loader>();

  const headerViewer =
    data.mode === 'hand_blackjack'
      ? { name: data.viewer.name, balance: data.viewer.balance }
      : { name: data.viewer.name, balance: 0 };

  if (data.mode === 'lobby') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 text-white">
        <SiteHeader viewer={headerViewer} />
        <RoomLobby room={data.room} seats={data.seats} lastHandSettled={data.lastHandSettled} />
      </div>
    );
  }

  if (data.mode === 'hand_poker') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 text-white">
        <SiteHeader viewer={headerViewer} />
        <PokerHandView
          roomId={data.room.id}
          handSeatId={data.handSeatId}
          initialView={data.view as unknown as FiveCardDrawView}
          viewerName={data.viewer.name}
        />
      </div>
    );
  }

  // hand_blackjack
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 text-white">
      <SiteHeader viewer={headerViewer} />
      <HandView
        roomId={data.room.id}
        handSeatId={data.handSeatId}
        initialView={data.view as unknown as BlackjackView}
        viewerName={data.viewer.name}
        viewerBalance={data.viewer.balance}
      />
    </div>
  );
}
