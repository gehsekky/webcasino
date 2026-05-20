import type { CardData } from 'lib/gameState';
import type { PlayerView } from 'engines/poker/fiveCardDraw/types';
import { CATEGORY_LABEL } from 'engines/poker/shared/types';
import PlayingCard from './PlayingCard';

type PokerSeatProps = {
  player: PlayerView;
  isViewer: boolean;
  isToAct: boolean;
  /** Display label — viewer name for the viewer, "Bot-Alpha" etc. for others. */
  label: string;
};

const STATUS_LABEL: Record<PlayerView['status'], string> = {
  active: 'in hand',
  folded: 'folded',
  all_in: 'all in',
};

const STATUS_CLASS: Record<PlayerView['status'], string> = {
  active: 'bg-emerald-600 text-white',
  folded: 'bg-slate-600 text-slate-200',
  all_in: 'bg-red-600 text-white',
};

export default function PokerSeat({ player, isViewer, isToAct, label }: PokerSeatProps) {
  const isMasked = !isViewer && player.cards.length > 0 && player.cards[0].suit === 'hidden';
  return (
    <section
      aria-labelledby={`seat-${player.id}-heading`}
      className={`rounded-xl p-4 sm:p-5 transition-shadow ${
        isToAct
          ? 'bg-emerald-800/70 ring-2 ring-yellow-400 shadow-lg shadow-yellow-500/20'
          : 'bg-emerald-900/40 ring-1 ring-emerald-700/40'
      } ${player.status === 'folded' ? 'opacity-60' : ''}`}
    >
      <header className="flex items-baseline justify-between mb-3 gap-3">
        <h3
          id={`seat-${player.id}-heading`}
          className="text-sm font-semibold uppercase tracking-wider text-emerald-200"
        >
          {label}
          {isViewer && (
            <span className="ml-2 text-xs font-normal lowercase text-emerald-300">(you)</span>
          )}
        </h3>
        <span
          className={`text-xs font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_CLASS[player.status]}`}
        >
          {STATUS_LABEL[player.status]}
        </span>
      </header>

      <div className="flex flex-wrap gap-2 min-h-[7rem]">
        {player.cards.length === 0 ? (
          <p className="text-emerald-200/60 italic self-center">no cards yet</p>
        ) : (
          player.cards.map((card: CardData, i: number) => (
            <PlayingCard key={`${card.suit}-${card.rank}-${i}`} card={card} small />
          ))
        )}
      </div>

      <footer className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-emerald-200/70 text-xs uppercase tracking-wide">Stack</p>
          <p className="font-semibold text-white tabular-nums">${player.chips.toLocaleString()}</p>
        </div>
        <div className="text-right">
          <p className="text-emerald-200/70 text-xs uppercase tracking-wide">In pot</p>
          <p className="font-semibold text-white tabular-nums">
            ${player.totalBet.toLocaleString()}
          </p>
        </div>
      </footer>

      {/* Rank only visible to viewer (or at showdown for all). */}
      {!isMasked && player.rank && (
        <p className="mt-2 text-xs text-yellow-300 font-semibold uppercase tracking-wider text-center">
          {CATEGORY_LABEL[player.rank.category]}
        </p>
      )}

      {isToAct && (
        <p className="mt-2 text-xs text-yellow-300 font-semibold uppercase tracking-wide text-center">
          ⇡ to act
        </p>
      )}
      {player.winnings > 0 && (
        <p className="mt-2 text-sm text-yellow-300 font-bold text-center tabular-nums">
          +${player.winnings.toLocaleString()}
        </p>
      )}
    </section>
  );
}
