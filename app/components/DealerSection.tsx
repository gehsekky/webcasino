import type { CardData } from 'lib/gameState';
import PlayingCard from './PlayingCard';
import { handTotal, hasHiddenCard } from 'lib/handMath';

type DealerSectionProps = {
  cards: CardData[];
  revealed: boolean;
};

export default function DealerSection({ cards, revealed }: DealerSectionProps) {
  const showTotal = revealed && !hasHiddenCard(cards);
  const total = showTotal ? handTotal(cards) : null;

  return (
    <section
      aria-labelledby="dealer-heading"
      className="rounded-xl bg-emerald-950/60 ring-1 ring-yellow-700/50 p-3 sm:p-4"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Dealer "avatar" — gold chip vibe, visually distinct from players. */}
        <div
          role="img"
          aria-label="dealer"
          className="shrink-0 inline-flex items-center justify-center rounded-full bg-yellow-400 text-slate-900 font-black shadow-md ring-2 ring-yellow-300 select-none"
          style={{ width: 48, height: 48, fontSize: 19 }}
        >
          ♠
        </div>

        <div className="min-w-0 w-40 shrink-0">
          <h2 id="dealer-heading" className="text-sm font-semibold text-white">
            Dealer
          </h2>
          <p className="text-[10px] uppercase tracking-wide text-yellow-300/80">house</p>
        </div>

        <div className="flex-1 min-w-0 flex flex-wrap gap-2 items-center">
          {cards.length === 0 ? (
            <p className="text-emerald-200/60 italic">waiting to deal…</p>
          ) : (
            cards.map((card, i) => (
              <PlayingCard key={`${card.suit}-${card.rank}-${i}`} card={card} small />
            ))
          )}
        </div>

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
