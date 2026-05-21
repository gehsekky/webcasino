import { Link } from '@remix-run/react';
import type { FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';
import { usePokerView } from 'hooks/usePokerView';
import PokerSeat from './PokerSeat';
import PokerActionArea from './PokerActionArea';
import PokerOutcomeBanner from './PokerOutcomeBanner';
import ConnectionStatus from './ConnectionStatus';
import SittingOutBanner from './SittingOutBanner';

type PokerHandViewProps = {
  /** Room this hand belongs to. Used for SSE subscription + back link. */
  roomId: string;
  /** Only the room creator can start the next hand. */
  isRoomCreator: boolean;
  /** Room's current game type — for the between-hands game switcher. */
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette' | 'baccarat';
  /** Room's seat count — gates which games can be switched to. */
  roomMaxSeats: number;
  /** Null when the viewer joined mid-hand and is spectating until the next round. */
  handSeatId: string | null;
  initialView: FiveCardDrawView;
  viewerName: string;
  /** hand_seat.id → {name, isAi} for each seat in this hand. */
  participants: Record<string, { name: string; isAi: boolean }>;
  /**
   * True when the viewer's persistent room seat is currently flagged
   * `sitting_out` — typically because they were auto-folded in this or
   * an earlier hand and haven't rejoined yet.
   */
  viewerSittingOut: boolean;
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
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
  handSeatId,
  initialView,
  viewerName,
  participants,
  viewerSittingOut,
}: PokerHandViewProps) {
  const { view, status } = usePokerView(roomId, initialView);

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

        {/* All seats in one vertical column — same shape as blackjack. */}
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
          {handSeatId && <PokerActionArea view={view} handSeatId={handSeatId} />}
          {handSeatId && (
            <PokerOutcomeBanner
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
