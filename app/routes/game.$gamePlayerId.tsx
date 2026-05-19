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
import { BlackjackStateSchema } from 'lib/gameState';
import { blackjackEngine } from 'engines/blackjack/engine';
import type { BlackjackView } from 'engines/blackjack/types';
import { findAreaForTable } from 'lib/casinoAreas';
import SiteHeader from 'components/SiteHeader';
import HandView from 'components/HandView';

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

  const state = BlackjackStateSchema.parse(handSeat.hand.data);
  const view: BlackjackView = blackjackEngine.viewFor(state, handSeatId);

  const table = handSeat.hand.casino_table;
  const areaMatch = findAreaForTable({
    gameType: table.game_type,
    minimumBet: table.minimum_bet,
    maximumBet: table.maximum_bet,
  });

  return json({
    handId: handSeat.hand_id,
    handSeatId: handSeat.id,
    view,
    viewer: { id: user.id, name: handSeat.user.name, balance: handSeat.user.money },
    area: areaMatch ? { id: areaMatch.area.id, name: areaMatch.area.name } : null,
    gameType: table.game_type,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const handSeatId = params.gamePlayerId;
  if (!handSeatId) {
    throw new Error('handSeatId is required');
  }
  await requireSeat(request, handSeatId);

  const formData = await request.formData();
  const submitValue = formData.get('submit')?.toString() ?? '';
  const action = parseBlackjackActionFromForm(submitValue, formData, handSeatId);
  await submitAction({ handSeatId, action });

  // Stay on the same page; the SSE channel pushes the new state, and the
  // fetcher-triggered loader revalidation refreshes the balance.
  return redirect(`/game/${handSeatId}`);
}

export default function GameRoute() {
  const data = useLoaderData<typeof loader>();
  // The loader's `view` is JSON-serialized; Remix's typing widens dates to
  // strings but our view contains no Date fields, so a cast through unknown
  // gets us back to the BlackjackView shape without runtime cost.
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
