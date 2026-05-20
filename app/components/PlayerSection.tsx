import type { PlayerSlot } from 'lib/gameState';
import PlayingCard from './PlayingCard';
import { handTotal } from 'lib/handMath';

type PlayerSectionProps = {
  player: PlayerSlot;
  isViewer: boolean;
  isToAct: boolean;
  viewerName: string;
  /** When set (after a split), suffix shown next to the player name (e.g. "Hand 1"). */
  handLabel?: string;
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_bet: 'awaiting bet',
  in_hand: 'in hand',
  stood: 'stood',
  busted: 'busted',
  surrendered: 'surrendered',
  won: 'won',
  lost: 'lost',
  pushed: 'push',
  blackjack: 'blackjack',
};

const STATUS_CLASS: Record<string, string> = {
  awaiting_bet: 'bg-slate-600 text-slate-100',
  in_hand: 'bg-emerald-600 text-white',
  stood: 'bg-slate-500 text-white',
  busted: 'bg-red-600 text-white',
  surrendered: 'bg-orange-600 text-white',
  won: 'bg-yellow-500 text-slate-900',
  lost: 'bg-red-700 text-white',
  pushed: 'bg-slate-400 text-slate-900',
  blackjack: 'bg-yellow-400 text-slate-900',
};

export default function PlayerSection({
  player,
  isViewer,
  isToAct,
  viewerName,
  handLabel,
}: PlayerSectionProps) {
  const total = player.cards.length > 0 ? handTotal(player.cards) : null;
  const displayName = isViewer ? viewerName : player.id.slice(0, 8);
  const statusLabel = STATUS_LABEL[player.status] ?? player.status;
  const statusClass = STATUS_CLASS[player.status] ?? 'bg-slate-500 text-white';

  return (
    <section
      aria-labelledby={`player-${player.id}-heading`}
      className={`rounded-xl p-4 sm:p-6 transition-shadow min-w-[10rem] ${
        isToAct
          ? 'bg-emerald-800/60 ring-2 ring-yellow-400 shadow-lg shadow-yellow-500/20'
          : 'bg-emerald-900/40 ring-1 ring-emerald-700/40'
      }`}
    >
      <header className="flex items-baseline justify-between mb-3 gap-3">
        <h2
          id={`player-${player.id}-heading`}
          className="text-sm font-semibold uppercase tracking-wider text-emerald-200"
        >
          {displayName}
          {isViewer && (
            <span className="ml-2 text-xs font-normal lowercase text-emerald-300">(you)</span>
          )}
          {handLabel && (
            <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-yellow-300">
              · {handLabel}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${statusClass}`}
          >
            {statusLabel}
          </span>
          {total !== null && (
            <span className="text-lg font-bold text-white tabular-nums">{total}</span>
          )}
        </div>
      </header>
      {/* Card row does not wrap — section grows with the cards instead,
          and the parent flex container wraps whole seats to a new row
          when they outgrow the container's width. */}
      <div className="flex gap-2 min-h-[8rem]">
        {player.cards.length === 0 ? (
          <p className="text-emerald-200/60 italic self-center">no cards yet</p>
        ) : (
          player.cards.map((card, i) => (
            <PlayingCard key={`${card.suit}-${card.rank}-${i}`} card={card} />
          ))
        )}
      </div>
      <footer className="mt-3 flex items-center justify-between text-sm">
        <span className="text-emerald-200/80">
          bet: <span className="font-semibold text-white tabular-nums">${player.bet}</span>
          {player.doubled && (
            <span className="ml-2 text-xs uppercase tracking-wide text-yellow-300">doubled</span>
          )}
        </span>
        {isToAct && (
          <span className="text-yellow-300 font-semibold uppercase tracking-wide text-xs">
            your turn
          </span>
        )}
      </footer>
    </section>
  );
}
