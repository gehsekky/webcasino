import { type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { prisma } from 'db.server';
import { getOptionalUser } from 'auth/guards.server';
import { providers } from 'auth/providers.server';
import { BlackjackStateSchema } from 'lib/gameState';
import SiteHeader from 'components/SiteHeader';
import SignInPanel from 'components/SignInPanel';
import CasinoLobby from 'components/CasinoLobby';

export const meta: MetaFunction = () => [
  { title: 'Web Casino' },
  { name: 'description', content: 'A multi-game casino built on a pluggable engine architecture.' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getOptionalUser(request);
  if (!user) {
    return {
      authed: false as const,
      providers: providers.map((p) => ({ id: p.id, label: p.label })),
    };
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { money: true } });

  const candidates = await prisma.hand_seat.findMany({
    where: { user_id: user.id },
    include: { hand: { include: { casino_table: { select: { game_type: true } } } } },
    orderBy: { created_at: 'desc' },
    take: 10,
  });

  const activeHands: { handSeatId: string; gameType: string; startedAt: string }[] = [];
  for (const seat of candidates) {
    try {
      const state = BlackjackStateSchema.parse(seat.hand.data);
      if (state.phase !== 'settled') {
        activeHands.push({
          handSeatId: seat.id,
          gameType: seat.hand.casino_table.game_type,
          startedAt: seat.created_at.toISOString(),
        });
      }
    } catch {
      // Skip rows whose data doesn't match the current schema.
    }
  }

  return {
    authed: true as const,
    viewer: { name: user.name, balance: dbUser?.money ?? 0 },
    activeHands,
  };
}

export default function Index() {
  const data = useLoaderData<typeof loader>();

  if (!data.authed) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 text-white">
        <SiteHeader viewer={null} />
        <SignInPanel providers={data.providers} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-950 text-white">
      <SiteHeader viewer={data.viewer} />
      <CasinoLobby
        viewerName={data.viewer.name}
        balance={data.viewer.balance}
        activeHands={data.activeHands}
      />
    </div>
  );
}
