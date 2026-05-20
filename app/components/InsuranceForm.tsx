import { useFetcher } from '@remix-run/react';
import { useState } from 'react';
import { buttonClass } from 'lib/buttonStyle';

type InsuranceFormProps = {
  /** The viewer's main wager. Insurance is capped at floor(bet / 2). */
  originalBet: number;
  balance: number;
};

export default function InsuranceForm({ originalBet, balance }: InsuranceFormProps) {
  const fetcher = useFetcher();
  const maxInsurance = Math.min(Math.floor(originalBet / 2), balance);
  const [amount, setAmount] = useState<number>(Math.max(1, maxInsurance));
  const submitting = fetcher.state !== 'idle';
  const invalid = amount < 1 || amount > maxInsurance;
  const cantAfford = maxInsurance < 1;

  return (
    <div className="rounded-xl bg-amber-950/50 ring-1 ring-amber-700/60 p-4 sm:p-5 space-y-3">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-amber-300 font-semibold">Insurance</p>
        <p className="text-white text-sm mt-1">
          Dealer shows an Ace. Bet up to half your wager that the dealer has a natural blackjack.
          Pays 2:1.
        </p>
      </div>

      <fetcher.Form method="post" className="flex flex-col sm:flex-row sm:items-stretch gap-2">
        <input type="hidden" name="submit" value="take insurance" />
        <div className="flex flex-1 items-stretch rounded-lg overflow-hidden ring-1 ring-amber-700/60 focus-within:ring-2 focus-within:ring-amber-400 bg-amber-950">
          <span aria-hidden="true" className="flex items-center px-3 text-amber-200 font-bold">
            $
          </span>
          <input
            type="number"
            inputMode="numeric"
            name="amount"
            min={1}
            max={maxInsurance}
            step={1}
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            disabled={cantAfford}
            className="flex-1 min-w-0 bg-transparent text-white px-3 py-2 text-lg tabular-nums focus:outline-none disabled:opacity-50"
            required
          />
        </div>
        <button
          type="submit"
          disabled={submitting || invalid || cantAfford}
          className={buttonClass({ variant: 'warning' })}
        >
          {submitting ? 'placing…' : 'Take'}
        </button>
      </fetcher.Form>

      <fetcher.Form method="post">
        <input type="hidden" name="submit" value="decline insurance" />
        <button
          type="submit"
          disabled={submitting}
          className={buttonClass({ variant: 'ghost', className: 'w-full' })}
        >
          Decline insurance
        </button>
      </fetcher.Form>

      <p className="text-xs text-amber-200/70 text-center">
        Max insurance ${maxInsurance.toLocaleString()} · balance ${balance.toLocaleString()}
      </p>
    </div>
  );
}
