import { Link } from '@remix-run/react';
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
              />
            );
          })}
        </div>

        <div className="pt-2">
          {isSpectator && view.phase !== 'settled' && (
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
