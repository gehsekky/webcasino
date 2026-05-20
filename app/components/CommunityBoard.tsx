import type { CardData } from 'lib/gameState';
import PlayingCard from './PlayingCard';

type CommunityBoardProps = {
  cards: CardData[];
};

/**
 * Center board for Hold'em — 5 slots, filled as the hand progresses.
 * Unrevealed slots show a placeholder so the table layout is stable from
 * preflop through river.
 */
export default function CommunityBoard({ cards }: CommunityBoardProps) {
  const slots = Array.from({ length: 5 }, (_, i) => cards[i] ?? null);
  return (
    <section
      aria-labelledby="community-heading"
      className="rounded-xl bg-emerald-950/60 ring-1 ring-yellow-700/50 p-3 sm:p-4"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div
          role="img"
          aria-label="community board"
          className="shrink-0 inline-flex items-center justify-center rounded-full bg-yellow-400 text-slate-900 font-black shadow-md ring-2 ring-yellow-300 select-none"
          style={{ width: 48, height: 48, fontSize: 19 }}
        >
          ♣
        </div>
        <div className="min-w-0 w-40 shrink-0">
          <h2 id="community-heading" className="text-sm font-semibold text-white">
            Board
          </h2>
          <p className="text-[10px] uppercase tracking-wide text-yellow-300/80">community</p>
        </div>
        <div className="flex-1 min-w-0 flex flex-wrap gap-2 items-center">
          {slots.map((card, i) =>
            card ? (
              <PlayingCard key={`${card.suit}-${card.rank}-${i}`} card={card} small />
            ) : (
              <PlaceholderSlot key={`empty-${i}`} />
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function PlaceholderSlot() {
  return (
    <div
      aria-hidden="true"
      className="w-16 h-24 rounded-lg border-2 border-dashed border-emerald-700/60 bg-emerald-900/20"
    />
  );
}
