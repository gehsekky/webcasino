import { useState } from 'react';
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  json,
  redirect,
} from '@remix-run/node';
import { Form, Link, useLoaderData } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import { prisma } from 'db.server';
import { getOptionalUser, requireUser } from 'auth/guards.server';
import { csrf, CSRFError } from 'auth/csrf.server';
import { providers } from 'auth/providers.server';
import {
  createRoom,
  acceptInvitation,
  declineInvitation,
  listUserRooms,
  listUserInvitations,
  type RoomGameType,
} from 'actions/tableLifecycle.server';
import SiteHeader from 'components/SiteHeader';
import SignInPanel from 'components/SignInPanel';
import CreateGameModal from 'components/CreateGameModal';
import { buttonClass } from 'lib/buttonStyle';

export const meta: MetaFunction = () => [
  { title: 'Web Casino' },
  { name: 'description', content: 'A multi-game multiplayer casino.' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getOptionalUser(request);
  if (!user) {
    return {
      authed: false as const,
      providers: providers.map((p) => ({ id: p.id, label: p.label })),
    };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { money: true },
  });

  const [rooms, invitations] = await Promise.all([
    listUserRooms(user.id),
    listUserInvitations(user.id),
  ]);

  return json({
    authed: true as const,
    viewer: { name: user.name, balance: dbUser?.money ?? 0 },
    rooms: rooms.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    invitations: invitations.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  try {
    await csrf.validate(formData, request.headers);
  } catch (e) {
    if (e instanceof CSRFError) throw new Response('invalid CSRF token', { status: 403 });
    throw e;
  }
  const intent = formData.get('intent')?.toString() ?? '';

  if (intent === 'create_room') {
    const name = formData.get('name')?.toString() ?? '';
    const gameType = formData.get('gameType')?.toString();
    const numSeats = parseInt(formData.get('numSeats')?.toString() ?? '', 10);
    const minBet = parseInt(formData.get('minBet')?.toString() ?? '', 10);
    const maxBet = parseInt(formData.get('maxBet')?.toString() ?? '', 10);

    const ALLOWED_GAME_TYPES: RoomGameType[] = [
      'blackjack',
      'poker',
      'holdem',
      'slots',
      'roulette',
      'baccarat',
    ];
    if (!ALLOWED_GAME_TYPES.includes(gameType as RoomGameType)) {
      throw new Response('invalid game type', { status: 400 });
    }
    if (!Number.isFinite(numSeats) || !Number.isFinite(minBet) || !Number.isFinite(maxBet)) {
      throw new Response('invalid numeric inputs', { status: 400 });
    }

    const result = await createRoom({
      creator: user,
      name,
      gameType: gameType as RoomGameType,
      numSeats,
      minimumBet: minBet,
      maximumBet: maxBet,
    });
    return redirect(`/rooms/${result.roomId}`);
  }

  if (intent === 'accept_invitation') {
    const invitationId = formData.get('invitationId')?.toString();
    if (!invitationId) throw new Response('invitationId required', { status: 400 });
    const result = await acceptInvitation({ user, invitationId });
    return redirect(`/rooms/${result.roomId}`);
  }

  if (intent === 'decline_invitation') {
    const invitationId = formData.get('invitationId')?.toString();
    if (!invitationId) throw new Response('invitationId required', { status: 400 });
    await declineInvitation({ user, invitationId });
    return redirect('/');
  }

  throw new Response(`unknown intent '${intent}'`, { status: 400 });
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const [createOpen, setCreateOpen] = useState(false);

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

      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="max-w-3xl mx-auto space-y-8">
          <header className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Your games</h1>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className={buttonClass({ variant: 'primary' })}
            >
              + Create game
            </button>
          </header>

          {/* Invitations — pending only. */}
          <section aria-labelledby="invitations-heading" className="space-y-3">
            <h2
              id="invitations-heading"
              className="text-sm uppercase tracking-wider text-emerald-200"
            >
              Invitations
            </h2>
            {data.invitations.length === 0 ? (
              <p className="text-sm italic text-emerald-200/60">no pending invitations</p>
            ) : (
              <ul className="space-y-2">
                {data.invitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-emerald-900/50 ring-1 ring-emerald-700/40 p-4"
                  >
                    <div>
                      <p className="font-semibold text-white">{inv.roomName}</p>
                      <p className="text-xs text-emerald-200/70 tabular-nums capitalize">
                        {inv.gameType === 'poker' ? '5-Card Draw' : inv.gameType} · $
                        {inv.minimumBet}–${inv.maximumBet} · {inv.maxSeats} seats
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Form method="post" className="inline-block">
                        <AuthenticityTokenInput />
                        <input type="hidden" name="intent" value="accept_invitation" />
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <button type="submit" className={buttonClass({ variant: 'primary' })}>
                          Accept
                        </button>
                      </Form>
                      <Form method="post" className="inline-block">
                        <AuthenticityTokenInput />
                        <input type="hidden" name="intent" value="decline_invitation" />
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <button type="submit" className={buttonClass({ variant: 'neutral' })}>
                          Decline
                        </button>
                      </Form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Active games — rooms the user is seated at. */}
          <section aria-labelledby="rooms-heading" className="space-y-3">
            <h2 id="rooms-heading" className="text-sm uppercase tracking-wider text-emerald-200">
              Active games
            </h2>
            {data.rooms.length === 0 ? (
              <p className="text-sm italic text-emerald-200/60">
                no active games — create one or accept an invite
              </p>
            ) : (
              <ul className="space-y-2">
                {data.rooms.map((room) => (
                  <li key={room.id}>
                    <Link
                      to={`/rooms/${room.id}`}
                      className="block rounded-xl bg-emerald-900/50 ring-1 ring-emerald-700/40 p-4 hover:bg-emerald-800/60 hover:ring-emerald-500 transition"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">
                            {room.name}
                            {room.isCreator && (
                              <span className="ml-2 text-xs uppercase tracking-wide text-yellow-300">
                                creator
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-emerald-200/70 tabular-nums capitalize">
                            {room.gameType === 'poker' ? '5-Card Draw' : room.gameType} · $
                            {room.minimumBet}–${room.maximumBet} · {room.seatedCount}/
                            {room.maxSeats} seated
                          </p>
                        </div>
                        <span
                          className={`text-xs font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                            room.hasActiveHand
                              ? 'bg-yellow-500 text-slate-900'
                              : 'bg-slate-700 text-emerald-100'
                          }`}
                        >
                          {room.hasActiveHand ? 'hand in progress' : 'idle'}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <CreateGameModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
