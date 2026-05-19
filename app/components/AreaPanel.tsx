import { Link, useFetcher } from '@remix-run/react';
import type { CasinoArea, AreaGame } from 'lib/casinoAreas';
import { buttonClass } from 'lib/buttonStyle';

type AreaPanelProps = {
  area: CasinoArea;
  balance: number;
};

export default function AreaPanel({ area, balance }: AreaPanelProps) {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <nav className="max-w-5xl mx-auto mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-emerald-200 hover:text-white"
        >
          ← Back to lobby
        </Link>
      </nav>

      <header className="max-w-3xl mx-auto text-center mb-10">
        <p className={`text-xs uppercase tracking-[0.3em] ${area.theme.accentText}`}>
          {area.tagline}
        </p>
        <h1 className="text-3xl sm:text-5xl font-bold text-white mt-2">{area.name}</h1>
        <p className="mt-4 text-emerald-100/80 text-base sm:text-lg leading-relaxed">
          {area.description}
        </p>
      </header>

      <section aria-labelledby="games-heading" className="max-w-5xl mx-auto">
        <h2 id="games-heading" className="sr-only">
          Games available in {area.name}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {area.games.map((game) => (
            <GameCard key={game.id} game={game} area={area} balance={balance} />
          ))}
        </div>
      </section>
    </div>
  );
}

function GameCard({
  game,
  area,
  balance,
}: {
  game: AreaGame;
  area: CasinoArea;
  balance: number;
}) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';
  const canAfford = balance >= game.minimumBet;
  const playable = game.available && canAfford;

  return (
    <article
      className={`rounded-xl ring-1 p-5 flex flex-col ${area.theme.cardBg} ${
        playable ? area.theme.cardHover : ''
      } transition-colors`}
    >
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xl font-bold text-white">{game.name}</h3>
        {!game.available && (
          <span className="text-xs uppercase tracking-wider rounded-full bg-slate-700 text-slate-200 px-2 py-0.5">
            soon
          </span>
        )}
      </header>
      <p className="text-sm text-emerald-100/70 mb-3">{game.blurb}</p>
      <p className={`text-sm font-semibold tabular-nums ${area.theme.accentText}`}>
        ${game.minimumBet.toLocaleString()} – ${game.maximumBet.toLocaleString()}
      </p>

      <div className="mt-auto pt-5">
        {!game.available ? (
          <button
            type="button"
            disabled
            className={buttonClass({ variant: 'neutral', className: 'w-full' })}
          >
            Coming soon
          </button>
        ) : !canAfford ? (
          <button
            type="button"
            disabled
            className={buttonClass({ variant: 'neutral', className: 'w-full' })}
            title={`Need at least $${game.minimumBet}`}
          >
            Balance too low
          </button>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="game" value={game.id} />
            <button
              type="submit"
              disabled={submitting}
              className={buttonClass({ variant: 'primary', className: 'w-full' })}
            >
              {submitting ? 'seating…' : 'Sit down'}
            </button>
          </fetcher.Form>
        )}
      </div>
    </article>
  );
}
