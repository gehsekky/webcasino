import { useFetcher } from '@remix-run/react';
import { useState } from 'react';

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

  const submitting = fetcher.state !== 'idle';
  const cannotAfford = balance < minimumBet;
  const invalid = amount < minimumBet || amount > maximumBet || amount > balance;

  return (
    <fetcher.Form method="post" className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
      <input type="hidden" name="submit" value="place initial bet" />
      <label className="flex-1">
        <span className="block text-xs font-semibold uppercase tracking-wider text-emerald-200 mb-1">
          Wager
        </span>
        <div className="flex items-stretch rounded-lg overflow-hidden ring-1 ring-emerald-700 focus-within:ring-2 focus-within:ring-yellow-400">
          <span className="flex items-center px-3 bg-emerald-950 text-emerald-200 font-bold text-lg">$</span>
          <input
            type="number"
            inputMode="numeric"
            name="amount"
            min={minimumBet}
            max={Math.min(maximumBet, balance)}
            step={1}
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            className="flex-1 bg-emerald-950 text-white px-3 py-2 text-lg tabular-nums focus:outline-none"
            aria-describedby="bet-bounds"
            required
          />
        </div>
        <p id="bet-bounds" className="mt-1 text-xs text-emerald-300/80">
          min ${minimumBet} · max ${maximumBet} · balance ${balance.toLocaleString()}
        </p>
      </label>
      <button
        type="submit"
        disabled={submitting || invalid || cannotAfford}
        className="btn btn-warning text-slate-900 font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'placing…' : cannotAfford ? 'insufficient balance' : 'place bet'}
      </button>
    </fetcher.Form>
  );
}
