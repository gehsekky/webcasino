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
      className="rounded-xl bg-emerald-900/50 ring-1 ring-emerald-700/50 p-4 sm:p-6"
    >
      <header className="flex items-baseline justify-between mb-4">
        <h2
          id="dealer-heading"
          className="text-sm font-semibold uppercase tracking-wider text-emerald-200"
        >
          Dealer
        </h2>
        {showTotal && <span className="text-lg font-bold text-white tabular-nums">{total}</span>}
      </header>
      <div className="flex flex-wrap gap-2 min-h-[7rem]">
        {cards.length === 0 ? (
          <p className="text-emerald-200/60 italic self-center">waiting to deal…</p>
        ) : (
          cards.map((card, i) => <PlayingCard key={`${card.suit}-${card.rank}-${i}`} card={card} />)
        )}
      </div>
    </section>
  );
}
