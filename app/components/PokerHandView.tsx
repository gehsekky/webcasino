import { Link } from '@remix-run/react';
import type { FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';
import { usePokerView } from 'hooks/usePokerView';
import PokerSeat from './PokerSeat';
import PokerActionArea from './PokerActionArea';
import PokerOutcomeBanner from './PokerOutcomeBanner';
import ConnectionStatus from './ConnectionStatus';

type PokerHandViewProps = {
  /** Room this hand belongs to. Used for SSE subscription + back link. */
  roomId: string;
  /** Null when the viewer joined mid-hand and is spectating until the next round. */
  handSeatId: string | null;
  initialView: FiveCardDrawView;
  viewerName: string;
};

const PHASE_LABEL: Record<FiveCardDrawView['phase'], string> = {
  awaiting_deal: 'Awaiting deal',
  betting_1: 'First betting round',
  draw: 'Draw',
  betting_2: 'Second betting round',
  showdown: 'Showdown',
  settled: 'Hand complete',
};

export default function PokerHandView({
  roomId,
  handSeatId,
  initialView,
  viewerName,
}: PokerHandViewProps) {
  const { view, status } = usePokerView(roomId, initialView);

  const viewerSlot = handSeatId ? view.players.find((p) => p.id === handSeatId) : undefined;
  const opponents = view.players.filter((p) => p.id !== handSeatId);
  const isSpectator = handSeatId === null;

  return (
    <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="max-w-4xl mx-auto space-y-4">
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

        {/* Opponents first; viewer slot rendered prominently below. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {opponents.map((p) => (
            <PokerSeat
              key={p.id}
              player={p}
              isViewer={false}
              isToAct={view.toAct === p.id}
              label={p.id.slice(0, 12)}
            />
          ))}
        </div>

        {viewerSlot && (
          <PokerSeat
            player={viewerSlot}
            isViewer
            isToAct={view.toAct === viewerSlot.id}
            label={viewerName}
          />
        )}

        <div className="pt-2">
          {isSpectator && view.phase !== 'settled' && (
            <p className="text-center text-emerald-200/80 italic">
              spectating — you join the next hand
            </p>
          )}
          {handSeatId && <PokerActionArea view={view} handSeatId={handSeatId} />}
          {handSeatId && <PokerOutcomeBanner view={view} handSeatId={handSeatId} roomId={roomId} />}
          {isSpectator && view.phase === 'settled' && <SpectatorPostHand roomId={roomId} />}
        </div>
      </div>
    </main>
  );
}

function SpectatorPostHand({ roomId }: { roomId: string }) {
  return (
    <div className="rounded-xl bg-slate-800 text-white px-6 py-5 text-center shadow-lg">
      <p className="text-lg font-semibold uppercase tracking-wide">Hand over</p>
      <p className="mt-2 text-sm opacity-80">you will join the next hand started at this room</p>
      <Link
        to={`/rooms/${roomId}`}
        className="mt-4 inline-block underline text-emerald-200 hover:text-white"
      >
        refresh
      </Link>
    </div>
  );
}
