import { useFetcher } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { buttonClass } from 'lib/buttonStyle';

const LAST_BET_STORAGE_KEY = 'webcasino:lastBet';

type BetFormProps = {
  minimumBet: number;
  maximumBet: number;
  balance: number;
  /** Default starting amount in the input. */
  defaultAmount?: number;
};

export default function BetForm({ minimumBet, maximumBet, balance, defaultAmount }: BetFormProps) {
  const fetcher = useFetcher();
  const cap = Math.min(maximumBet, balance);
  const start = Math.min(Math.max(defaultAmount ?? minimumBet, minimumBet), cap);
  const [amount, setAmount] = useState<number>(start);

  // After hydration, prefer the last-bet value from localStorage if it fits
  // within this table's bounds. SSR-safe: localStorage read happens in effect.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAST_BET_STORAGE_KEY);
      if (saved === null) return;
      const parsed = parseInt(saved, 10);
      if (!Number.isFinite(parsed)) return;
      const clamped = Math.min(Math.max(parsed, minimumBet), cap);
      setAmount(clamped);
    } catch {
      // localStorage unavailable (e.g. private mode) — fall back to defaults.
    }
  }, [minimumBet, cap]);

  const submitting = fetcher.state !== 'idle';
  const cannotAfford = balance < minimumBet;
  const invalid = amount < minimumBet || amount > maximumBet || amount > balance;

  const handleSubmit = () => {
    try {
      window.localStorage.setItem(LAST_BET_STORAGE_KEY, String(amount));
    } catch {
      // ignore quota/permission errors
    }
  };

  return (
    <fetcher.Form method="post" className="space-y-2" onSubmit={handleSubmit}>
      <input type="hidden" name="submit" value="place initial bet" />
      <label
        htmlFor="bet-amount"
        className="block text-xs font-semibold uppercase tracking-wider text-emerald-200"
      >
        Wager
      </label>
      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 items-stretch rounded-lg overflow-hidden ring-1 ring-emerald-700 focus-within:ring-2 focus-within:ring-yellow-400 bg-emerald-950">
          <span
            aria-hidden="true"
            className="flex items-center px-3 text-emerald-200 font-bold text-lg"
          >
            $
          </span>
          <input
            id="bet-amount"
            type="number"
            inputMode="numeric"
            name="amount"
            min={minimumBet}
            max={Math.min(maximumBet, balance)}
            step={1}
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            className="flex-1 min-w-0 bg-transparent text-white px-3 py-2 text-lg tabular-nums focus:outline-none"
            aria-describedby="bet-bounds"
            required
          />
        </div>
        <button
          type="submit"
          disabled={submitting || invalid || cannotAfford}
          className={buttonClass({ variant: 'primary', className: 'shrink-0' })}
        >
          {submitting ? 'placing…' : cannotAfford ? 'no funds' : 'place bet'}
        </button>
      </div>
      <p id="bet-bounds" className="text-xs text-emerald-300/80">
        min ${minimumBet} · max ${maximumBet} · balance ${balance.toLocaleString()}
      </p>
    </fetcher.Form>
  );
}
