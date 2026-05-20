import type { CardData } from 'lib/gameState';
import type { ActorStatus } from 'engines/poker/shared/bettingRound';
import { CATEGORY_LABEL, type HandRank } from 'engines/poker/shared/types';
import PlayingCard from './PlayingCard';
import Avatar from './Avatar';

/**
 * Structural seat shape. Shared between 5-card draw and Hold'em (and any
 * future poker variant) — the seat row only needs identity + cards + chip
 * info + rank, nothing variant-specific.
 */
type SeatPlayer = {
  id: string;
  cards: CardData[];
  status: ActorStatus;
  chips: number;
  currentBet: number;
  totalBet: number;
  rank: HandRank | null;
  winnings: number;
};

type PokerSeatProps = {
  player: SeatPlayer;
  isViewer: boolean;
  isToAct: boolean;
  /** Display name of whoever holds this seat. AI seats use the bot's name. */
  ownerName: string;
  /** True when the seat's owner is a synthetic AI user. */
  ownerIsAi: boolean;
};

const STATUS_LABEL: Record<ActorStatus, string> = {
  active: 'in hand',
  folded: 'folded',
  all_in: 'all in',
};

const STATUS_CLASS: Record<ActorStatus, string> = {
  active: 'bg-emerald-600 text-white',
  folded: 'bg-slate-600 text-slate-200',
  all_in: 'bg-red-600 text-white',
};

export default function PokerSeat({
  player,
  isViewer,
  isToAct,
  ownerName,
  ownerIsAi,
}: PokerSeatProps) {
  const isMasked = !isViewer && player.cards.length > 0 && player.cards[0].suit === 'hidden';
  const showRank = !isMasked && player.rank;

  return (
    <section
      aria-labelledby={`seat-${player.id}-heading`}
      className={`rounded-xl p-3 sm:p-4 transition-shadow ${
        isToAct
          ? 'bg-emerald-800/70 ring-2 ring-yellow-400 shadow-lg shadow-yellow-500/20'
          : 'bg-emerald-900/40 ring-1 ring-emerald-700/40'
      } ${player.status === 'folded' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <Avatar name={ownerName} isAi={ownerIsAi} size={48} />

        {/* Identity / status / chip info column. Fixed-ish width so card
            rows line up across seats. */}
        <div className="min-w-0 w-40 shrink-0">
          <h3
            id={`seat-${player.id}-heading`}
            className="text-sm font-semibold text-white truncate"
          >
            {ownerName}
            {isViewer && (
              <span className="ml-1 text-xs font-normal lowercase text-emerald-300">(you)</span>
            )}
          </h3>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5 ${STATUS_CLASS[player.status]}`}
            >
              {STATUS_LABEL[player.status]}
            </span>
          </div>
          <p className="mt-1 text-xs text-emerald-200/80">
            stack{' '}
            <span className="font-semibold text-white tabular-nums">
              ${player.chips.toLocaleString()}
            </span>
          </p>
          <p className="text-xs text-emerald-200/80">
            in pot{' '}
            <span className="font-semibold text-white tabular-nums">
              ${player.totalBet.toLocaleString()}
            </span>
          </p>
        </div>

        {/* Cards — fill the negative space. Wraps inside the row if needed. */}
        <div className="flex-1 min-w-0 flex flex-wrap gap-2 items-center">
          {player.cards.length === 0 ? (
            <p className="text-emerald-200/60 italic">no cards yet</p>
          ) : (
            player.cards.map((card: CardData, i: number) => (
              <PlayingCard key={`${card.suit}-${card.rank}-${i}`} card={card} small />
            ))
          )}
        </div>

        {/* Right-side annotations: rank label, to-act indicator, winnings.
            Stack vertically; collapse to nothing if none apply. */}
        <div className="shrink-0 w-24 text-right space-y-0.5">
          {showRank && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-yellow-300">
              {CATEGORY_LABEL[player.rank!.category]}
            </p>
          )}
          {isToAct && (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-300">
              ⇡ to act
            </p>
          )}
          {player.winnings > 0 && (
            <p className="text-sm text-yellow-300 font-bold tabular-nums">
              +${player.winnings.toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
