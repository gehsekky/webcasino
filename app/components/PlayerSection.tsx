import type { PlayerSlot } from 'lib/gameState';
import PlayingCard from './PlayingCard';
import Avatar from './Avatar';
import TurnTimer from './TurnTimer';
import { handTotal } from 'lib/handMath';

type PlayerSectionProps = {
  player: PlayerSlot;
  isViewer: boolean;
  isToAct: boolean;
  /** Display name of whoever owns this slot. AI fills get a bot name. */
  ownerName: string;
  /** True when the slot's owner is a synthetic AI user. */
  ownerIsAi: boolean;
  /**
   * Auto-fold deadline for the seat currently on the clock. Passed in
   * from the view; combined with `isToAct` to decide whether to render
   * the countdown badge.
   */
  turnDeadlineAt: string | null;
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
  ownerName,
  ownerIsAi,
  turnDeadlineAt,
  handLabel,
}: PlayerSectionProps) {
  const total = player.cards.length > 0 ? handTotal(player.cards) : null;
  const statusLabel = STATUS_LABEL[player.status] ?? player.status;
  const statusClass = STATUS_CLASS[player.status] ?? 'bg-slate-500 text-white';

  return (
    <section
      aria-labelledby={`player-${player.id}-heading`}
      className={`rounded-xl p-3 sm:p-4 transition-shadow ${
        isToAct
          ? 'bg-emerald-800/60 ring-2 ring-yellow-400 shadow-lg shadow-yellow-500/20'
          : 'bg-emerald-900/40 ring-1 ring-emerald-700/40'
      }`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <Avatar name={ownerName} isAi={ownerIsAi} size={48} />

        {/* Identity / status / bet block — fixed-ish width so cards always
            line up across rows. min-w-0 lets the name truncate cleanly. */}
        <div className="min-w-0 w-40 shrink-0">
          <h2
            id={`player-${player.id}-heading`}
            className="text-sm font-semibold text-white truncate"
          >
            {ownerName}
            {isViewer && (
              <span className="ml-1 text-xs font-normal lowercase text-emerald-300">(you)</span>
            )}
          </h2>
          {handLabel && (
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">
              {handLabel}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2">
            <TurnTimer deadlineAt={turnDeadlineAt} active={isToAct} />
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5 ${statusClass}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-emerald-200/80">
            bet <span className="font-semibold text-white tabular-nums">${player.bet}</span>
            {player.doubled && (
              <span className="ml-1 text-[10px] uppercase tracking-wide text-yellow-300">
                doubled
              </span>
            )}
          </p>
        </div>

        {/* Cards — fill the negative space. Wraps if the row's too narrow. */}
        <div className="flex-1 min-w-0 flex flex-wrap gap-2 items-center">
          {player.cards.length === 0 ? (
            <p className="text-emerald-200/60 italic">no cards yet</p>
          ) : (
            player.cards.map((card, i) => (
              <PlayingCard key={`${card.suit}-${card.rank}-${i}`} card={card} small />
            ))
          )}
        </div>

        {/* Total on the right, always present so the row width is stable. */}
        <div className="shrink-0 w-12 text-right">
          {total !== null ? (
            <span className="text-2xl font-bold text-white tabular-nums">{total}</span>
          ) : (
            <span className="text-emerald-200/40 text-sm">—</span>
          )}
        </div>
      </div>
    </section>
  );
}
