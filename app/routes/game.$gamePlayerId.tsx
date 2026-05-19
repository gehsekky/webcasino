import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  json,
  redirect,
} from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { prisma } from 'db.server';
import { requireUser, requireSeat } from 'auth/guards.server';
import {
  submitAction,
  parseBlackjackActionFromForm,
} from 'actions/handEngine.server';
import {
  submitPokerAction,
  parsePokerActionFromForm,
} from 'actions/pokerEngine.server';
import { BlackjackStateSchema } from 'lib/gameState';
import { blackjackEngine } from 'engines/blackjack/engine';
import type { BlackjackView } from 'engines/blackjack/types';
import { fiveCardDrawEngine } from 'engines/poker/fiveCardDraw/engine';
import type { FiveCardDrawState, FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';
import { findAreaForTable } from 'lib/casinoAreas';
import SiteHeader from 'components/SiteHeader';
import HandView from 'components/HandView';
import PokerHandView from 'components/PokerHandView';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const handSeatId = params.gamePlayerId;
  if (!handSeatId) {
    throw new Error('handSeatId is required');
  }
  const user = await requireUser(request);
  await requireSeat(request, handSeatId);

  const handSeat = await prisma.hand_seat.findUnique({
    where: { id: handSeatId },
    include: {
      hand: { include: { casino_table: true } },
      user: { select: { name: true, money: true } },
    },
  });
  if (!handSeat) {
    throw new Response('seat not found', { status: 404 });
  }

  const table = handSeat.hand.casino_table;
  const areaMatch = findAreaForTable({
    gameType: table.game_type,
    minimumBet: table.minimum_bet,
    maximumBet: table.maximum_bet,
  });
  const area = areaMatch ? { id: areaMatch.area.id, name: areaMatch.area.name } : null;
  const viewer = { id: user.id, name: handSeat.user.name, balance: handSeat.user.money };

  if (table.game_type === 'poker') {
    const state = handSeat.hand.data as unknown as FiveCardDrawState;
    if (state?.type !== 'fivecarddraw') {
      throw new Error('game route: corrupt poker state');
    }
    const view = fiveCardDrawEngine.viewFor(state, handSeatId);
    return json({
      handId: handSeat.hand_id,
      handSeatId: handSeat.id,
      gameType: 'poker' as const,
      view,
      viewer,
      area,
    });
  }

  const bjState = BlackjackStateSchema.parse(handSeat.hand.data);
  const bjView: BlackjackView = blackjackEngine.viewFor(bjState, handSeatId);
  return json({
    handId: handSeat.hand_id,
    handSeatId: handSeat.id,
    gameType: 'blackjack' as const,
    view: bjView,
    viewer,
    area,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const handSeatId = params.gamePlayerId;
  if (!handSeatId) {
    throw new Error('handSeatId is required');
  }
  await requireSeat(request, handSeatId);

  // Determine game type to dispatch.
  const handSeat = await prisma.hand_seat.findUnique({
    where: { id: handSeatId },
    include: { hand: { include: { casino_table: { select: { game_type: true } } } } },
  });
  if (!handSeat) {
    throw new Response('seat not found', { status: 404 });
  }
  const gameType = handSeat.hand.casino_table.game_type;

  const formData = await request.formData();
  const submitValue = formData.get('submit')?.toString() ?? '';

  if (gameType === 'poker') {
    const action = parsePokerActionFromForm(submitValue, formData, handSeatId);
    await submitPokerAction({ handSeatId, action });
  } else {
    const action = parseBlackjackActionFromForm(submitValue, formData, handSeatId);
    await submitAction({ handSeatId, action });
  }

  return redirect(`/game/${handSeatId}`);
}

export default function GameRoute() {
  const data = useLoaderData<typeof loader>();

  if (data.gameType === 'poker') {
    const initialView = data.view as unknown as FiveCardDrawView;
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 text-white">
        <SiteHeader viewer={{ name: data.viewer.name, balance: data.viewer.balance }} />
        <PokerHandView
          handId={data.handId}
          handSeatId={data.handSeatId}
          initialView={initialView}
          viewerName={data.viewer.name}
          area={data.area}
        />
      </div>
    );
  }

  const initialView = data.view as unknown as BlackjackView;
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 text-white">
      <SiteHeader viewer={{ name: data.viewer.name, balance: data.viewer.balance }} />
      <HandView
        handId={data.handId}
        handSeatId={data.handSeatId}
        initialView={initialView}
        viewerName={data.viewer.name}
        viewerBalance={data.viewer.balance}
        area={data.area}
        gameType={data.gameType}
      />
    </div>
  );
}
