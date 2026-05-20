import { type ActionFunctionArgs, type LoaderFunctionArgs, json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { prisma } from 'db.server';
import { requireUser } from 'auth/guards.server';
import { csrf, CSRFError } from 'auth/csrf.server';
import { startHand, switchRoomGame, type RoomGameType } from 'actions/tableLifecycle.server';
import { submitAction, parseBlackjackActionFromForm } from 'actions/handEngine.server';
import { submitPokerAction, parsePokerActionFromForm } from 'actions/pokerEngine.server';
import { submitHoldemAction, parseHoldemActionFromForm } from 'actions/holdemEngine.server';
import { submitSlotsAction, parseSlotsActionFromForm } from 'actions/slotsEngine.server';
import { submitRouletteAction, parseRouletteActionFromForm } from 'actions/rouletteEngine.server';
import { listRecentMessages, sendChatMessage } from 'actions/chat.server';
import { blackjackEngine } from 'engines/blackjack/engine';
import { fiveCardDrawEngine } from 'engines/poker/fiveCardDraw/engine';
import { holdemEngine } from 'engines/poker/holdem/engine';
import { slotsEngine } from 'engines/slots/engine';
import { rouletteEngine } from 'engines/roulette/engine';
import { BlackjackStateSchema } from 'lib/gameState';
import type { BlackjackView } from 'engines/blackjack/types';
import type { FiveCardDrawState, FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';
import type { HoldemState, HoldemView } from 'engines/poker/holdem/types';
import type { SlotsState, SlotsView } from 'engines/slots/types';
import type { RouletteState, RouletteView } from 'engines/roulette/types';
import SiteHeader from 'components/SiteHeader';
import RoomLobby from 'components/RoomLobby';
import HandView from 'components/HandView';
import PokerHandView from 'components/PokerHandView';
import HoldemHandView from 'components/HoldemHandView';
import SlotsHandView from 'components/SlotsHandView';
import RouletteHandView from 'components/RouletteHandView';
import ChatPane from 'components/ChatPane';

type RoomSeatSummary = {
  position: number;
  userId: string;
  name: string;
  isAi: boolean;
  isViewer: boolean;
  isCreator: boolean;
};

const GAME_LABEL: Record<RoomGameType, string> = {
  blackjack: 'Blackjack',
  poker: '5-Card Draw',
  holdem: "Texas Hold'em",
  slots: 'Slots',
  roulette: 'Roulette',
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

  const latest = room.hand[0];

  const roomSummary = {
    id: room.id,
    name: room.name,
    gameType: room.game_type,
    minimumBet: room.minimum_bet,
    maximumBet: room.maximum_bet,
    maxSeats: room.max_seats,
    joinToken: room.join_token,
    isCreator: room.created_by === user.id,
  };

  // Chat scrollback for the room. Shared across all three view modes.
  const chatMessages = await listRecentMessages(roomId);

  if (!latest) {
    // Brand-new room with no hand yet — show lobby. Once a hand exists
    // (active OR settled), we render the hand view; the settled outcome
    // banner lives between rounds so players can read the result.
    return json({
      mode: 'lobby' as const,
      room: roomSummary,
      seats,
      viewer,
      chatMessages,
    });
  }

  // A hand exists (active or settled). Pull every hand_seat in this hand
  // with its user info — used both to find the viewer's seat and to build
  // a slot id → {name, isAi} mapping for the UI to render avatars/names.
  const handSeats = await prisma.hand_seat.findMany({
    where: { hand_id: latest.id },
    select: {
      id: true,
      user_id: true,
      user: { select: { name: true, is_ai: true } },
    },
  });
  const viewerHandSeat = handSeats.find((hs) => hs.user_id === user.id);
  const handSeatId = viewerHandSeat?.id ?? null;
  const projectionTarget = handSeatId ?? 'spectator';
  const participants: Record<string, { name: string; isAi: boolean }> = {};
  for (const hs of handSeats) {
    participants[hs.id] = { name: hs.user.name, isAi: hs.user.is_ai };
  }

  // Derive the hand's game type from its own persisted state, not from
  // `room.game_type`. Room game can change between hands (game switcher),
  // so the just-settled hand may be of a different type than the room's
  // current setting. The room's setting only governs the *next* hand.
  const handStateType = (latest.data as { type?: string } | null)?.type;

  if (handStateType === 'fivecarddraw') {
    const state = latest.data as unknown as FiveCardDrawState;
    const view = fiveCardDrawEngine.viewFor(state, projectionTarget);
    return json({
      mode: 'hand_poker' as const,
      room: roomSummary,
      seats,
      viewer,
      handId: latest.id,
      handSeatId,
      view,
      participants,
      chatMessages,
    });
  }

  if (handStateType === 'holdem') {
    const state = latest.data as unknown as HoldemState;
    const view = holdemEngine.viewFor(state, projectionTarget);
    return json({
      mode: 'hand_holdem' as const,
      room: roomSummary,
      seats,
      viewer,
      handId: latest.id,
      handSeatId,
      view,
      participants,
      chatMessages,
    });
  }

  if (handStateType === 'slots') {
    const state = latest.data as unknown as SlotsState;
    const view = slotsEngine.viewFor(state, projectionTarget);
    // Look up the viewer's wallet so the BetForm can size its input.
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { money: true },
    });
    return json({
      mode: 'hand_slots' as const,
      room: roomSummary,
      seats,
      viewer: { ...viewer, balance: dbUser?.money ?? 0 },
      handId: latest.id,
      handSeatId,
      view,
      participants,
      chatMessages,
    });
  }

  if (handStateType === 'roulette') {
    const state = latest.data as unknown as RouletteState;
    const view = rouletteEngine.viewFor(state, projectionTarget);
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { money: true },
    });
    return json({
      mode: 'hand_roulette' as const,
      room: roomSummary,
      seats,
      viewer: { ...viewer, balance: dbUser?.money ?? 0 },
      handId: latest.id,
      handSeatId,
      view,
      participants,
      chatMessages,
    });
  }

  if (handStateType === 'blackjack') {
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
      participants,
      chatMessages,
    });
  }

  throw new Error(`rooms loader: unknown hand state type '${handStateType ?? '(missing)'}'`);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const roomId = params.roomId;
  if (!roomId) throw new Response('roomId required', { status: 400 });
  const user = await requireUser(request);

  const formData = await request.formData();
  try {
    await csrf.validate(formData, request.headers);
  } catch (e) {
    if (e instanceof CSRFError) throw new Response('invalid CSRF token', { status: 403 });
    throw e;
  }
  const intent = formData.get('intent')?.toString() ?? '';

  // Membership gate: every action on this route requires a seat at the room.
  // Chat + start_hand bypass the per-hand `hand_seat` lookup below, but
  // both still must be room members.
  const isMember = await prisma.seat.findFirst({
    where: { table_id: roomId, user_id: user.id },
    select: { id: true },
  });
  if (!isMember) {
    throw new Response('not a member of this room', { status: 403 });
  }

  if (intent === 'chat') {
    const body = formData.get('body')?.toString() ?? '';
    await sendChatMessage({ roomId, userId: user.id, body });
    // Return a small JSON ack instead of redirecting; the form is submitted
    // as a fetcher, so a redirect would just bounce through the loader.
    return json({ ok: true });
  }

  if (intent === 'start_hand') {
    await startHand({ roomId, startedBy: user });
    return redirect(`/rooms/${roomId}`);
  }

  if (intent === 'switch_game') {
    const target = formData.get('gameType')?.toString() ?? '';
    const ALLOWED_GAMES: RoomGameType[] = ['blackjack', 'poker', 'holdem', 'slots', 'roulette'];
    if (!ALLOWED_GAMES.includes(target as RoomGameType)) {
      throw new Response('invalid game type', { status: 400 });
    }
    const result = await switchRoomGame({
      roomId,
      newGameType: target as RoomGameType,
      by: user,
    });
    // Auto-start a fresh hand of the new game so the creator doesn't have
    // to click Switch then Start — and so the prior-game outcome banner is
    // replaced immediately by the new game's hand view.
    if (result.changed) {
      await startHand({ roomId, startedBy: user });
    }
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
  const stateType = (latest.data as { type?: string } | null)?.type;
  if (stateType === 'fivecarddraw') {
    const parsed = parsePokerActionFromForm(submitValue, formData, handSeat.id);
    await submitPokerAction({ handSeatId: handSeat.id, action: parsed });
  } else if (stateType === 'holdem') {
    const parsed = parseHoldemActionFromForm(submitValue, formData, handSeat.id);
    await submitHoldemAction({ handSeatId: handSeat.id, action: parsed });
  } else if (stateType === 'slots') {
    const parsed = parseSlotsActionFromForm(submitValue, formData, handSeat.id);
    await submitSlotsAction({ handSeatId: handSeat.id, action: parsed });
  } else if (stateType === 'roulette') {
    const parsed = parseRouletteActionFromForm(submitValue, formData, handSeat.id);
    await submitRouletteAction({ handSeatId: handSeat.id, action: parsed });
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

  const gt = data.room.gameType as RoomGameType;
  const main =
    data.mode === 'lobby' ? (
      <RoomLobby room={data.room} seats={data.seats} />
    ) : data.mode === 'hand_poker' ? (
      // key={handId}: remount on hand transition so the view-hook state
      // and SSE subscription reset cleanly against the new hand.
      <PokerHandView
        key={data.handId}
        roomId={data.room.id}
        isRoomCreator={data.room.isCreator}
        roomGameType={gt}
        roomMaxSeats={data.room.maxSeats}
        handSeatId={data.handSeatId}
        initialView={data.view as unknown as FiveCardDrawView}
        viewerName={data.viewer.name}
        participants={data.participants}
      />
    ) : data.mode === 'hand_holdem' ? (
      <HoldemHandView
        key={data.handId}
        roomId={data.room.id}
        isRoomCreator={data.room.isCreator}
        roomGameType={gt}
        roomMaxSeats={data.room.maxSeats}
        handSeatId={data.handSeatId}
        initialView={data.view as unknown as HoldemView}
        viewerName={data.viewer.name}
        participants={data.participants}
      />
    ) : data.mode === 'hand_slots' ? (
      <SlotsHandView
        key={data.handId}
        roomId={data.room.id}
        isRoomCreator={data.room.isCreator}
        roomGameType={gt}
        roomMaxSeats={data.room.maxSeats}
        handSeatId={data.handSeatId}
        initialView={data.view as unknown as SlotsView}
        viewerName={data.viewer.name}
        viewerBalance={data.viewer.balance}
      />
    ) : data.mode === 'hand_roulette' ? (
      <RouletteHandView
        key={data.handId}
        roomId={data.room.id}
        isRoomCreator={data.room.isCreator}
        roomGameType={gt}
        roomMaxSeats={data.room.maxSeats}
        handSeatId={data.handSeatId}
        initialView={data.view as unknown as RouletteView}
        viewerName={data.viewer.name}
        viewerBalance={data.viewer.balance}
        participants={data.participants}
      />
    ) : (
      <HandView
        key={data.handId}
        roomId={data.room.id}
        isRoomCreator={data.room.isCreator}
        roomGameType={gt}
        roomMaxSeats={data.room.maxSeats}
        handSeatId={data.handSeatId}
        initialView={data.view as unknown as BlackjackView}
        viewerName={data.viewer.name}
        viewerBalance={data.viewer.balance}
        participants={data.participants}
      />
    );

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 text-white">
      <SiteHeader viewer={headerViewer} />
      {/* Two-pane layout: main game/lobby on the left, sticky chat pane on
          the right at lg+. Stacks below on smaller screens. The inner
          views (HandView / PokerHandView / RoomLobby) no longer wrap
          themselves in a container — this grid owns the page layout. */}
      <div className="px-4 sm:px-6 py-4 lg:py-6 grid gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] max-w-screen-xl mx-auto">
        <div className="min-w-0 space-y-3">
          <div className="flex items-baseline gap-2 px-1">
            <h1 className="text-xl font-bold text-white">{data.room.name}</h1>
            <span className="text-sm text-emerald-200/70">·</span>
            <span className="text-sm uppercase tracking-wider text-emerald-200/70">
              {GAME_LABEL[gt]}
            </span>
          </div>
          {main}
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <ChatPane
            roomId={data.room.id}
            initialMessages={data.chatMessages}
            viewerUserId={data.viewer.id}
          />
        </div>
      </div>
    </div>
  );
}
