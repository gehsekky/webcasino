import { Link } from '@remix-run/react';
import type { FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';
import { usePokerView } from 'hooks/usePokerView';
import PokerSeat from './PokerSeat';
import PokerActionArea from './PokerActionArea';
import PokerOutcomeBanner from './PokerOutcomeBanner';
import ConnectionStatus from './ConnectionStatus';

type PokerHandViewProps = {
  handId: string;
  handSeatId: string;
  initialView: FiveCardDrawView;
  viewerName: string;
  area: { id: string; name: string } | null;
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
  handId,
  handSeatId,
  initialView,
  viewerName,
  area,
}: PokerHandViewProps) {
  const { view, status } = usePokerView(handId, initialView);

  // Display ordering: viewer first, then opponents in seat order (so the
  // viewer sees themselves at the bottom of the visual stack later if we
  // ever flip the layout, and the opponents on top).
  const viewerSlot = view.players.find((p) => p.id === handSeatId);
  const opponents = view.players.filter((p) => p.id !== handSeatId);

  return (
    <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto space-y-4">
        <nav className="px-1">
          <Link
            to={area ? `/casino/${area.id}` : '/'}
            className="inline-flex items-center gap-1 text-sm text-emerald-200 hover:text-white"
          >
            ← Back to {area ? area.name : 'lobby'}
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
          <PokerActionArea view={view} handSeatId={handSeatId} />
          <PokerOutcomeBanner view={view} handSeatId={handSeatId} area={area} />
        </div>
      </div>
    </main>
  );
}
