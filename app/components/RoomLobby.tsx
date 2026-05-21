import { useState } from 'react';
import { Form, Link } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import { buttonClass } from 'lib/buttonStyle';
import GameSwitcher from './GameSwitcher';
import SeatSwitcher from './SeatSwitcher';

type RoomSummary = {
  id: string;
  name: string;
  gameType: string;
  minimumBet: number;
  maximumBet: number;
  maxSeats: number;
  joinToken: string | null;
  isCreator: boolean;
};

type RoomSeatRow = {
  position: number;
  userId: string;
  name: string;
  isAi: boolean;
  isViewer: boolean;
  isCreator: boolean;
  /** True when this seat is currently flagged out of rotation. */
  sittingOut: boolean;
};

type RoomLobbyProps = {
  room: RoomSummary;
  seats: RoomSeatRow[];
};

/**
 * Lobby view for a brand-new room with no hand yet. Once any hand exists
 * (active or settled) the room view shows the hand surface instead — the
 * settled outcome banner serves as the between-rounds resting state.
 */
export default function RoomLobby({ room, seats }: RoomLobbyProps) {
  // Render the relative path on both SSR and client to keep the input value
  // hydration-stable. The absolute URL is only computed at copy time, when
  // we're guaranteed to be on the client.
  const joinPath = room.joinToken ? `/join/${room.joinToken}` : null;
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!joinPath) return;
    const absolute = new URL(joinPath, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* clipboard refused; fall back is the visible text */
    }
  };

  const seatsByPosition = new Map(seats.map((s) => [s.position, s]));
  const allPositions = Array.from({ length: room.maxSeats }, (_, i) => i + 1);

  return (
    <main>
      <div className="space-y-6">
        <nav className="px-1">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-emerald-200 hover:text-white"
          >
            ← Back to landing
          </Link>
        </nav>

        <header className="space-y-2">
          <p className="text-sm text-emerald-200/80 tabular-nums">
            Stakes ${room.minimumBet}–${room.maximumBet} · {room.maxSeats} seats
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <GameSwitcher
              roomId={room.id}
              currentGame={room.gameType as 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette'}
              maxSeats={room.maxSeats}
              isRoomCreator={room.isCreator}
            />
            <SeatSwitcher
              roomId={room.id}
              currentGame={room.gameType as 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette'}
              maxSeats={room.maxSeats}
              seatedCount={seats.length}
              isRoomCreator={room.isCreator}
            />
          </div>
        </header>

        {/* Roster: shows persistent humans only. Empty positions are filled
            by AI when the next hand starts. */}
        <section
          aria-labelledby="roster-heading"
          className="rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 p-4 sm:p-6"
        >
          <h2
            id="roster-heading"
            className="text-sm uppercase tracking-wider text-emerald-200 mb-3"
          >
            Roster
          </h2>
          <ul className="space-y-2">
            {allPositions.map((pos) => {
              const s = seatsByPosition.get(pos);
              return (
                <li
                  key={pos}
                  className="flex items-center justify-between rounded bg-emerald-950/60 px-3 py-2"
                >
                  <span className="text-xs uppercase tracking-wider text-emerald-200/70">
                    Seat {pos}
                  </span>
                  {s ? (
                    <span className="flex items-center gap-2 text-sm text-white">
                      <span>
                        {s.name}
                        {s.isViewer && (
                          <span className="ml-2 text-xs text-emerald-300 lowercase">(you)</span>
                        )}
                        {s.isCreator && (
                          <span className="ml-2 text-xs text-yellow-300 uppercase">creator</span>
                        )}
                        {s.sittingOut && (
                          <span className="ml-2 text-xs text-amber-300 uppercase">sitting out</span>
                        )}
                      </span>
                      {s.isViewer && s.sittingOut && (
                        <Form method="post" action={`/rooms/${room.id}`}>
                          <AuthenticityTokenInput />
                          <input type="hidden" name="intent" value="rejoin_next_hand" />
                          <button
                            type="submit"
                            className="rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-amber-400"
                          >
                            Rejoin next hand
                          </button>
                        </Form>
                      )}
                    </span>
                  ) : (
                    <span className="text-sm italic text-emerald-200/50">
                      empty — fills with AI on next hand
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Shareable join link. Copy-to-clipboard with a fallback to a
            visible text field. */}
        {joinPath && (
          <section
            aria-labelledby="invite-heading"
            className="rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 p-4 sm:p-6"
          >
            <h2
              id="invite-heading"
              className="text-sm uppercase tracking-wider text-emerald-200 mb-3"
            >
              Invite players
            </h2>
            <div className="flex gap-2">
              <input
                readOnly
                value={joinPath}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded bg-emerald-950 border border-emerald-700 px-3 py-2 text-sm text-white font-mono"
                aria-label="Join URL"
              />
              <button
                type="button"
                onClick={copyLink}
                className={buttonClass({ variant: 'neutral' })}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs text-emerald-200/60">
              Anyone with the link can request to join. They appear in your roster after they accept
              the invitation on their landing page.
            </p>
          </section>
        )}

        {/* Start Hand: only the creator can kick off a hand for now. */}
        {room.isCreator && (
          <Form method="post" action={`/rooms/${room.id}`}>
            <AuthenticityTokenInput />
            <input type="hidden" name="intent" value="start_hand" />
            <button
              type="submit"
              className={buttonClass({ variant: 'primary', className: 'w-full' })}
            >
              Start Hand
            </button>
          </Form>
        )}
        {!room.isCreator && (
          <p className="text-center text-sm italic text-emerald-200/70">
            waiting for the room creator to start a hand…
          </p>
        )}
      </div>
    </main>
  );
}
