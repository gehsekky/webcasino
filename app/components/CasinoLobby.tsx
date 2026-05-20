import { Link } from '@remix-run/react';
import { AREAS } from 'lib/casinoAreas';

type ActiveHandSummary = {
  handSeatId: string;
  gameType: string;
  startedAt: string;
};

type CasinoLobbyProps = {
  viewerName: string;
  balance: number;
  activeHands: ActiveHandSummary[];
};

export default function CasinoLobby({ viewerName, balance, activeHands }: CasinoLobbyProps) {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <header className="max-w-3xl mx-auto text-center mb-10 sm:mb-14">
        <p className="text-emerald-300 text-sm uppercase tracking-[0.3em]">Welcome back</p>
        <h1 className="text-3xl sm:text-5xl font-bold text-white mt-2">{viewerName}</h1>
        <div className="mt-4 inline-flex items-baseline gap-2 rounded-full bg-emerald-900/70 ring-1 ring-emerald-700 px-5 py-2">
          <span className="text-emerald-300 text-xs uppercase tracking-wider">balance</span>
          <span className="text-2xl font-bold text-yellow-300 tabular-nums">
            ${balance.toLocaleString()}
          </span>
        </div>
      </header>

      <section aria-labelledby="areas-heading" className="max-w-5xl mx-auto">
        <h2
          id="areas-heading"
          className="text-center text-emerald-200 text-sm uppercase tracking-widest mb-6"
        >
          Choose your area
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {AREAS.map((area) => {
            const minEntry = Math.min(
              ...area.games.filter((g) => g.available).map((g) => g.minimumBet),
            );
            const canAfford = balance >= minEntry;
            return (
              <Link
                key={area.id}
                to={`/casino/${area.id}`}
                aria-disabled={!canAfford}
                className={`group block rounded-2xl ring-1 p-6 sm:p-8 transition-all ${area.theme.cardBg} ${area.theme.cardHover} ${canAfford ? '' : 'opacity-60 cursor-not-allowed pointer-events-none'}`}
              >
                <p className={`text-xs uppercase tracking-[0.3em] ${area.theme.accentText}`}>
                  {area.tagline}
                </p>
                <h3 className="text-2xl sm:text-3xl font-bold text-white mt-2">{area.name}</h3>
                <p className="mt-3 text-emerald-100/80 text-sm sm:text-base leading-relaxed">
                  {area.description}
                </p>
                <p className="mt-6 flex items-center justify-between text-sm">
                  <span
                    className={`uppercase tracking-wider font-semibold ${area.theme.accentText}`}
                  >
                    {canAfford ? 'Enter →' : 'Balance too low'}
                  </span>
                  <span className="text-white/60 text-xs">
                    {area.games.filter((g) => g.available).length} game
                    {area.games.filter((g) => g.available).length === 1 ? '' : 's'} open
                  </span>
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {activeHands.length > 0 && (
        <section aria-labelledby="continue-heading" className="max-w-3xl mx-auto mt-12">
          <h2
            id="continue-heading"
            className="text-center text-emerald-200 text-sm uppercase tracking-widest mb-4"
          >
            Continue a hand
          </h2>
          <ul className="space-y-2">
            {activeHands.map((h) => (
              <li key={h.handSeatId}>
                <Link
                  to={`/game/${h.handSeatId}`}
                  className="block rounded-lg bg-emerald-900/40 ring-1 ring-emerald-800 px-4 py-3 hover:bg-emerald-900/70 transition-colors"
                >
                  <p className="font-semibold text-white capitalize">{h.gameType}</p>
                  <p className="text-xs text-emerald-300/80">
                    started {new Date(h.startedAt).toLocaleString()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
