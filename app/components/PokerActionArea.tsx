import { useFetcher } from '@remix-run/react';
import { useState } from 'react';
import { buttonClass } from 'lib/buttonStyle';
import type { FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';

type PokerActionAreaProps = {
  view: FiveCardDrawView;
  handSeatId: string;
};

/**
 * Renders the right action surface based on what the engine says is
 * legal for the viewer right now:
 *  - betting phase (and viewer is to act) → fold/check/call/bet/raise
 *  - draw phase (and viewer is to act)    → discard picker
 *  - otherwise                            → an explanatory blurb
 */
export default function PokerActionArea({ view, handSeatId }: PokerActionAreaProps) {
  const isViewerActing = view.toAct === handSeatId;
  const viewerSlot = view.players.find((p) => p.id === handSeatId);

  if (view.phase === 'settled') {
    return null; // OutcomeBanner handles this case.
  }

  if (!isViewerActing) {
    return (
      <p className="text-center text-emerald-200/70 italic">waiting for another seat to act…</p>
    );
  }

  if (view.phase === 'draw') {
    if (!viewerSlot) return null;
    return <DiscardPicker viewerSlot={viewerSlot} />;
  }

  if (view.phase === 'betting_1' || view.phase === 'betting_2') {
    return <BetActionBar view={view} viewerSlot={viewerSlot} />;
  }

  return null;
}

function BetActionBar({
  view,
  viewerSlot,
}: {
  view: FiveCardDrawView;
  viewerSlot: FiveCardDrawView['players'][number] | undefined;
}) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';
  const owed = viewerSlot ? Math.max(0, view.pot.currentBet - viewerSlot.currentBet) : 0;
  const minBet = view.config.minBet;
  const minRaiseTarget = view.pot.currentBet + view.pot.minRaise;

  const [betAmount, setBetAmount] = useState<number>(minBet);
  const [raiseTo, setRaiseTo] = useState<number>(minRaiseTarget);

  const legalKinds = new Set(view.legalActions.map((a) => a.kind));

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

      <div className="flex flex-wrap gap-2 justify-center">
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
      </div>

      {legalKinds.has('bet') && (
        <fetcher.Form method="post" className="flex items-stretch gap-2 justify-center">
          <input type="hidden" name="submit" value="bet" />
          <input
            type="number"
            name="amount"
            min={minBet}
            step={1}
            value={betAmount}
            onChange={(e) => setBetAmount(parseInt(e.target.value, 10) || minBet)}
            className="w-28 bg-emerald-950 text-white px-3 py-2 rounded-lg ring-1 ring-emerald-700 tabular-nums"
            aria-label="Bet amount"
          />
          <button
            type="submit"
            disabled={submitting || betAmount < minBet}
            className={buttonClass({ variant: 'warning' })}
          >
            Bet
          </button>
        </fetcher.Form>
      )}

      {legalKinds.has('raise') && (
        <fetcher.Form method="post" className="flex items-stretch gap-2 justify-center">
          <input type="hidden" name="submit" value="raise" />
          <input
            type="number"
            name="amount"
            min={minRaiseTarget}
            step={1}
            value={raiseTo}
            onChange={(e) => setRaiseTo(parseInt(e.target.value, 10) || minRaiseTarget)}
            className="w-28 bg-emerald-950 text-white px-3 py-2 rounded-lg ring-1 ring-emerald-700 tabular-nums"
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
      <input type="hidden" name="submit" value={submitValue} />
      <button type="submit" disabled={disabled} className={buttonClass({ variant })}>
        {label}
      </button>
    </fetcher.Form>
  );
}

function DiscardPicker({ viewerSlot }: { viewerSlot: FiveCardDrawView['players'][number] }) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';
  const [marked, setMarked] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    const next = new Set(marked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setMarked(next);
  };

  return (
    <div className="rounded-xl bg-amber-950/40 ring-1 ring-amber-700/50 p-4 space-y-3">
      <p className="text-center text-sm">
        <span className="text-amber-300 font-semibold uppercase tracking-wider">Draw</span>{' '}
        <span className="text-amber-200/80">— click cards to discard, then confirm.</span>
      </p>

      <div className="flex flex-wrap gap-2 justify-center">
        {viewerSlot.cards.map((card, i) => (
          <button
            key={`${card.suit}-${card.rank}-${i}`}
            type="button"
            onClick={() => toggle(i)}
            className={`relative transition-transform ${marked.has(i) ? 'translate-y-2 opacity-50' : 'hover:-translate-y-1'}`}
            aria-pressed={marked.has(i)}
            aria-label={`${marked.has(i) ? 'Discard' : 'Keep'} ${card.rank} of ${card.suit}`}
          >
            <CardFace card={card} />
            {marked.has(i) && (
              <span className="absolute top-1 right-1 text-amber-300 text-xs font-bold uppercase tracking-wide bg-amber-950 px-1.5 py-0.5 rounded">
                ✕
              </span>
            )}
          </button>
        ))}
      </div>

      <fetcher.Form method="post" className="flex justify-center">
        <input type="hidden" name="submit" value="discard" />
        <input type="hidden" name="indices" value={[...marked].sort((a, b) => a - b).join(',')} />
        <button type="submit" disabled={submitting} className={buttonClass({ variant: 'warning' })}>
          {marked.size === 0 ? 'Stand pat' : `Discard ${marked.size}`}
        </button>
      </fetcher.Form>
    </div>
  );
}

// Tiny local card render so the discard picker can size cards distinctly
// (clickable, slightly larger) without leaking layout choices into the
// reusable PlayingCard component.
import type { CardData } from 'lib/gameState';
function CardFace({ card }: { card: CardData }) {
  const suit = card.suit;
  const glyph =
    suit === 'hearts'
      ? '♥'
      : suit === 'diamonds'
        ? '♦'
        : suit === 'spades'
          ? '♠'
          : suit === 'clubs'
            ? '♣'
            : '?';
  const color = suit === 'hearts' || suit === 'diamonds' ? 'text-red-600' : 'text-slate-900';
  const rank =
    card.rank === 'Ace'
      ? 'A'
      : card.rank === 'King'
        ? 'K'
        : card.rank === 'Queen'
          ? 'Q'
          : card.rank === 'Jack'
            ? 'J'
            : card.rank;
  return (
    <div className="w-16 h-24 rounded-lg border border-slate-300 bg-white shadow-md flex flex-col justify-between p-2 select-none">
      <span className={`${color} font-bold leading-none text-lg`}>{rank}</span>
      <span className={`${color} text-center text-3xl leading-none`}>{glyph}</span>
      <span className={`${color} font-bold leading-none self-end rotate-180 text-lg`}>{rank}</span>
    </div>
  );
}
