import { Form, Link } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import type { HoldemView } from 'engines/poker/holdem/types';
import { useHoldemView } from 'hooks/useHoldemView';
import PokerSeat from './PokerSeat';
import HoldemActionArea from './HoldemActionArea';
import HoldemOutcomeBanner from './HoldemOutcomeBanner';
import CommunityBoard from './CommunityBoard';
import ConnectionStatus from './ConnectionStatus';

type HoldemHandViewProps = {
  roomId: string;
  isRoomCreator: boolean;
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';
  roomMaxSeats: number;
  handSeatId: string | null;
  initialView: HoldemView;
  viewerName: string;
  participants: Record<string, { name: string; isAi: boolean }>;
  /**
   * True when the viewer's persistent room seat is currently flagged
   * `sitting_out` — typically because they were auto-folded in this or
   * an earlier hand and haven't rejoined yet.
   */
  viewerSittingOut: boolean;
};

const PHASE_LABEL: Record<HoldemView['phase'], string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
  settled: 'Hand complete',
};

export default function HoldemHandView({
  roomId,
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
  handSeatId,
  initialView,
  viewerName,
  participants,
  viewerSittingOut,
}: HoldemHandViewProps) {
  const { view, status } = useHoldemView(roomId, initialView);
  const isSpectator = handSeatId === null;

  return (
    <main>
      <div className="space-y-4">
        <nav className="px-1">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-emerald-200 hover:text-white"
          >
            ← Back to landing
          </Link>
        </nav>

        <div className="flex items-center justify-between gap-3 px-1">
          <span className="text-xs font-semibold uppercase tracking-wider rounded-full bg-emerald-900/60 px-3 py-1 text-emerald-200 ring-1 ring-emerald-700/60">
            {PHASE_LABEL[view.phase]}
          </span>
          <span className="text-xs uppercase tracking-wider text-emerald-200/70 tabular-nums">
            Pot: ${view.pot.total.toLocaleString()}
          </span>
          <ConnectionStatus status={status} />
        </div>

        <CommunityBoard cards={view.community} />

        <div className="flex flex-col gap-3">
          {view.players.map((p) => {
            const isViewer = p.id === handSeatId;
            const owner = participants[p.id];
            const ownerName = isViewer ? viewerName : (owner?.name ?? p.id.slice(0, 8));
            const ownerIsAi = owner?.isAi ?? false;
            return (
              <PokerSeat
                key={p.id}
                player={p}
                isViewer={isViewer}
                isToAct={view.toAct === p.id}
                ownerName={ownerName}
                ownerIsAi={ownerIsAi}
                turnDeadlineAt={view.turnDeadlineAt}
              />
            );
          })}
        </div>

        <div className="pt-2">
          {viewerSittingOut && <SittingOutBanner />}
          {isSpectator && !viewerSittingOut && view.phase !== 'settled' && (
            <p className="text-center text-emerald-200/80 italic">
              spectating — you join the next hand
            </p>
          )}
          {handSeatId && <HoldemActionArea view={view} handSeatId={handSeatId} />}
          {handSeatId && (
            <HoldemOutcomeBanner
              view={view}
              handSeatId={handSeatId}
              roomId={roomId}
              isRoomCreator={isRoomCreator}
              roomGameType={roomGameType}
              roomMaxSeats={roomMaxSeats}
            />
          )}
          {isSpectator && view.phase === 'settled' && (
            <SpectatorPostHand roomId={roomId} isRoomCreator={isRoomCreator} />
          )}
        </div>
      </div>
    </main>
  );
}

function SittingOutBanner() {
  return (
    <div className="rounded-xl bg-amber-900/40 ring-1 ring-amber-600/50 text-amber-100 px-5 py-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide">You&apos;re sitting out</p>
      <p className="mt-1 text-xs opacity-80">
        You were auto-folded for missing your turn. You&apos;ll be skipped from the next hand until
        you rejoin.
      </p>
      <Form method="post" className="mt-3">
        <AuthenticityTokenInput />
        <input type="hidden" name="intent" value="rejoin_next_hand" />
        <button
          type="submit"
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400"
        >
          Rejoin next hand
        </button>
      </Form>
    </div>
  );
}

function SpectatorPostHand({ roomId, isRoomCreator }: { roomId: string; isRoomCreator: boolean }) {
  return (
    <div className="rounded-xl bg-slate-800 text-white px-6 py-5 text-center shadow-lg">
      <p className="text-lg font-semibold uppercase tracking-wide">Hand over</p>
      <p className="mt-2 text-sm opacity-80">
        {isRoomCreator
          ? 'start the next hand from the outcome banner above'
          : 'waiting for the room creator to start the next hand…'}
      </p>
      <Link
        to={`/rooms/${roomId}`}
        className="mt-4 inline-block underline text-emerald-200 hover:text-white"
      >
        refresh
      </Link>
    </div>
  );
}
