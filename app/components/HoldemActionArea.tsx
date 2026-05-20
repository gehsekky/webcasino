import { useFetcher } from '@remix-run/react';
import { useState } from 'react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import { buttonClass } from 'lib/buttonStyle';
import type { HoldemView } from 'engines/poker/holdem/types';

type HoldemActionAreaProps = {
  view: HoldemView;
  handSeatId: string;
};

/**
 * Action surface for Texas Hold'em. Layout mirrors `PokerActionArea`
 * (one row: card actions │ bet/raise inputs) but tailored to Hold'em:
 * no draw phase, and the table's minimum-bet anchor is the big blind
 * rather than a `minBet` setting.
 */
export default function HoldemActionArea({ view, handSeatId }: HoldemActionAreaProps) {
  const isViewerActing = view.toAct === handSeatId;
  const viewerSlot = view.players.find((p) => p.id === handSeatId);

  if (view.phase === 'settled' || view.phase === 'showdown') return null;
  if (!isViewerActing) {
    return (
      <p className="text-center text-emerald-200/70 italic">waiting for another seat to act…</p>
    );
  }
  return <BetBar view={view} viewerSlot={viewerSlot} />;
}

function BetBar({
  view,
  viewerSlot,
}: {
  view: HoldemView;
  viewerSlot: HoldemView['players'][number] | undefined;
}) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';
  const owed = viewerSlot ? Math.max(0, view.pot.currentBet - viewerSlot.currentBet) : 0;
  const minOpenBet = view.config.bigBlind;
  const minRaiseTarget = view.pot.currentBet + view.pot.minRaise;

  const [betAmount, setBetAmount] = useState<number>(minOpenBet);
  const [raiseTo, setRaiseTo] = useState<number>(minRaiseTarget);

  const legalKinds = new Set(view.legalActions.map((a) => a.kind));
  const hasCardAction = legalKinds.has('fold') || legalKinds.has('check') || legalKinds.has('call');
  const hasBettingAction = legalKinds.has('bet') || legalKinds.has('raise');

  return (
    <div className="rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 p-4 space-y-3">
      <div className="text-center text-sm">
        <span className="text-emerald-200/70 uppercase tracking-wider text-xs">Pot</span>{' '}
        <span className="font-bold text-white tabular-nums">
          ${view.pot.total.toLocaleString()}
        </span>
        {owed > 0 && (
          <span className="ml-3 text-yellow-300">
            to call: <span className="font-bold tabular-nums">${owed.toLocaleString()}</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-stretch justify-center gap-2">
        {legalKinds.has('fold') && (
          <SingleButton
            submitValue="fold"
            label="Fold"
            variant="danger"
            disabled={submitting}
            fetcher={fetcher}
          />
        )}
        {legalKinds.has('check') && (
          <SingleButton
            submitValue="check"
            label="Check"
            variant="info"
            disabled={submitting}
            fetcher={fetcher}
          />
        )}
        {legalKinds.has('call') && (
          <SingleButton
            submitValue="call"
            label={`Call $${owed}`}
            variant="success"
            disabled={submitting}
            fetcher={fetcher}
          />
        )}

        {hasCardAction && hasBettingAction && (
          <span aria-hidden="true" className="self-stretch w-px bg-emerald-700/60 mx-1" />
        )}

        {legalKinds.has('bet') && (
          <fetcher.Form method="post" className="flex items-stretch gap-1">
            <AuthenticityTokenInput />
            <input type="hidden" name="submit" value="bet" />
            <input
              type="number"
              name="amount"
              min={minOpenBet}
              step={1}
              value={betAmount}
              onChange={(e) => setBetAmount(parseInt(e.target.value, 10) || minOpenBet)}
              className="w-20 bg-emerald-950 text-white px-2 py-2 rounded-lg ring-1 ring-emerald-700 tabular-nums"
              aria-label="Bet amount"
            />
            <button
              type="submit"
              disabled={submitting || betAmount < minOpenBet}
              className={buttonClass({ variant: 'warning' })}
            >
              Bet
            </button>
          </fetcher.Form>
        )}

        {legalKinds.has('raise') && (
          <fetcher.Form method="post" className="flex items-stretch gap-1">
            <AuthenticityTokenInput />
            <input type="hidden" name="submit" value="raise" />
            <input
              type="number"
              name="amount"
              min={minRaiseTarget}
              step={1}
              value={raiseTo}
              onChange={(e) => setRaiseTo(parseInt(e.target.value, 10) || minRaiseTarget)}
              className="w-20 bg-emerald-950 text-white px-2 py-2 rounded-lg ring-1 ring-emerald-700 tabular-nums"
              aria-label="Raise to"
            />
            <button
              type="submit"
              disabled={submitting || raiseTo < minRaiseTarget}
              className={buttonClass({ variant: 'warning' })}
            >
              Raise to
            </button>
          </fetcher.Form>
        )}
      </div>
    </div>
  );
}

function SingleButton({
  submitValue,
  label,
  variant,
  disabled,
  fetcher,
}: {
  submitValue: string;
  label: string;
  variant: 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'primary' | 'ghost';
  disabled: boolean;
  fetcher: ReturnType<typeof useFetcher>;
}) {
  return (
    <fetcher.Form method="post">
      <AuthenticityTokenInput />
      <input type="hidden" name="submit" value={submitValue} />
      <button type="submit" disabled={disabled} className={buttonClass({ variant })}>
        {label}
      </button>
    </fetcher.Form>
  );
}
