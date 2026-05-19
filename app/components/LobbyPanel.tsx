import { Form, Link } from '@remix-run/react';

type ActiveHandSummary = {
  handSeatId: string;
  gameType: string;
  startedAt: string;
};

type LobbyPanelProps = {
  viewerName: string;
  balance: number;
  activeHands: ActiveHandSummary[];
};

export default function LobbyPanel({ viewerName, balance, activeHands }: LobbyPanelProps) {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl bg-emerald-950/60 ring-1 ring-emerald-800 p-6 sm:p-8 shadow-2xl">
          <p className="text-emerald-300 text-sm uppercase tracking-wider">Welcome back</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mt-1">{viewerName}</h1>
          <div className="mt-4 inline-flex items-baseline gap-2 rounded-lg bg-emerald-900/70 px-4 py-2">
            <span className="text-emerald-300 text-sm">balance</span>
            <span className="text-2xl font-bold text-yellow-300 tabular-nums">
              ${balance.toLocaleString()}
            </span>
          </div>

          <div className="mt-8">
            <h2 className="text-lg font-semibold text-white mb-3">Start a hand</h2>
            <Form method="post" className="flex flex-col sm:flex-row gap-3">
              <input type="hidden" name="submit" value="create new" />
              <input type="hidden" name="gameType" value="blackjack" />
              <button
                type="submit"
                className="btn btn-warning text-slate-900 font-bold uppercase tracking-wide flex-1"
              >
                ♠ New Blackjack Hand
              </button>
            </Form>
            <p className="mt-2 text-xs text-emerald-300/70">
              Other games coming soon. The engine layer is generic — slots, poker, baccarat
              each ship as a new module on top of the same contract.
            </p>
          </div>

          {activeHands.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-white mb-3">Continue a hand</h2>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
