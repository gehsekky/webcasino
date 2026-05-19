import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
} from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { prisma } from 'db.server';
import { requireUser } from 'auth/guards.server';
import { createNewHand } from 'actions/handEngine.server';
import { findGameInArea, getAreaById, type CasinoArea } from 'lib/casinoAreas';
import SiteHeader from 'components/SiteHeader';
import AreaPanel from 'components/AreaPanel';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const name = data && 'area' in data ? (data.area as CasinoArea).name : 'Casino';
  return [{ title: `${name} · Web Casino` }];
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const area = getAreaById(params.areaId);
  if (!area) {
    throw new Response('area not found', { status: 404 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { money: true, name: true },
  });
  return {
    area,
    viewer: { name: dbUser?.name ?? user.name, balance: dbUser?.money ?? 0 },
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const area = getAreaById(params.areaId);
  if (!area) {
    throw new Response('area not found', { status: 404 });
  }
  const formData = await request.formData();
  const gameId = formData.get('game')?.toString() ?? '';
  const game = findGameInArea(area, gameId);
  if (!game || !game.available) {
    throw new Response('game unavailable', { status: 400 });
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (dbUser.money < game.minimumBet) {
    throw new Response('balance too low for this table', { status: 400 });
  }

  const { handSeatId } = await createNewHand({
    user: dbUser,
    gameType: game.id,
    minimumBet: game.minimumBet,
    maximumBet: game.maximumBet,
    numDecks: game.rules?.numDecks,
    dealerHitsSoft17: game.rules?.dealerHitsSoft17,
  });
  return redirect(`/game/${handSeatId}`);
}

export default function AreaRoute() {
  const { area, viewer } = useLoaderData<typeof loader>();
  return (
    <div className={`min-h-screen bg-gradient-to-b ${area.theme.pageBg} text-white`}>
      <SiteHeader viewer={viewer} />
      <AreaPanel area={area} balance={viewer.balance} />
    </div>
  );
}
