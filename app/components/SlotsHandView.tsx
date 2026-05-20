import { Form, Link, useFetcher } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import { SLOT_SYMBOL_GLYPH, type SlotsView } from 'engines/slots/types';
import { buttonClass } from 'lib/buttonStyle';
import GameSwitcher from './GameSwitcher';
import ConnectionStatus from './ConnectionStatus';

type SlotsHandViewProps = {
  roomId: string;
  isRoomCreator: boolean;
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';
  roomMaxSeats: number;
  handSeatId: string | null;
  initialView: SlotsView;
  viewerName: string;
  viewerBalance: number;
};

const PAYOUT_LABEL: Record<string, string> = {
  three_seven: '★ JACKPOT — 100×',
  three_bar: 'Triple BAR — 25×',
  three_bell: 'Triple Bell — 10×',
  three_lemon: 'Triple Lemon — 5×',
  three_cherry: 'Triple Cherry — 2×',
  two_seven: 'Two Sevens — 3×',
  lose: 'No match',
};

export default function SlotsHandView({
  roomId,
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
  handSeatId,
  initialView,
  viewerName,
  viewerBalance,
}: SlotsHandViewProps) {
  // SSE updates only matter when another seat (impossible here, 1-seat
  // game) acts. We seed the view from props and ignore the stream — the
  // page revalidates on submit and re-renders with the new state.
  const view = initialView;
  const slot = view.players[0];
  const isViewer = handSeatId === slot?.id;

  return (
    <main>
      <div className="space-y-4">
        <nav className="px-1">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-emerald-200 hover:text-white"
          >
            ← Back to landing
          </Link>
        </nav>

        <div className="flex items-center justify-between gap-3 px-1">
          <span className="text-xs font-semibold uppercase tracking-wider rounded-full bg-emerald-900/60 px-3 py-1 text-emerald-200 ring-1 ring-emerald-700/60">
            {view.phase === 'settled' ? 'Result' : 'Place your bet'}
          </span>
          <ConnectionStatus status="open" />
        </div>

        <ReelDisplay view={view} />

        {view.phase === 'awaiting_bet' && isViewer && (
          <BetForm
            min={view.config.minimumBet}
            max={view.config.maximumBet}
            balance={viewerBalance}
            roomId={roomId}
          />
        )}

        {view.phase === 'settled' && (
          <OutcomePanel
            view={view}
            roomId={roomId}
            isRoomCreator={isRoomCreator}
            roomGameType={roomGameType}
            roomMaxSeats={roomMaxSeats}
            viewerName={viewerName}
          />
        )}
      </div>
    </main>
  );
}

function ReelDisplay({ view }: { view: SlotsView }) {
  const reels = view.players[0]?.reels ?? [];
  const slots: Array<string | null> = [0, 1, 2].map((i) => reels[i] ?? null);
  return (
    <div className="rounded-xl bg-emerald-950/60 ring-1 ring-yellow-700/50 p-6 flex items-center justify-center gap-4">
      {slots.map((symbol, i) => (
        <div
          key={i}
          className="w-24 h-32 rounded-lg bg-white ring-2 ring-yellow-300 flex items-center justify-center text-6xl shadow-inner select-none"
          aria-label={symbol ?? 'empty reel'}
        >
          {symbol ? SLOT_SYMBOL_GLYPH[symbol as keyof typeof SLOT_SYMBOL_GLYPH] : '–'}
        </div>
      ))}
    </div>
  );
}

function BetForm({
  min,
  max,
  balance,
  roomId,
}: {
  min: number;
  max: number;
  balance: number;
  roomId: string;
}) {
  const fetcher = useFetcher();
  const cap = Math.min(max, balance);
  const [amount, setAmount] = useState<number>(Math.max(min, Math.min(cap, min)));
  // Recompute amount when balance changes.
  useEffect(() => {
    setAmount((current) => Math.min(Math.max(current, min), Math.min(max, balance)));
  }, [min, max, balance]);

  const submitting = fetcher.state !== 'idle';
  const cantAfford = balance < min;
  const invalid = amount < min || amount > max || amount > balance;

  return (
    <fetcher.Form
      method="post"
      action={`/rooms/${roomId}`}
      className="rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 p-4 space-y-3"
    >
      <AuthenticityTokenInput />
      <input type="hidden" name="submit" value="spin" />
      <label
        htmlFor="slots-amount"
        className="block text-xs font-semibold uppercase tracking-wider text-emerald-200"
      >
        Wager
      </label>
      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 items-stretch rounded-lg overflow-hidden ring-1 ring-emerald-700 focus-within:ring-2 focus-within:ring-yellow-400 bg-emerald-950">
          <span className="flex items-center px-3 text-emerald-200 font-bold text-lg">$</span>
          <input
            id="slots-amount"
            type="number"
            inputMode="numeric"
            name="amount"
            min={min}
            max={Math.min(max, balance)}
            step={1}
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            className="flex-1 min-w-0 bg-transparent text-white px-3 py-2 text-lg tabular-nums focus:outline-none"
            required
          />
        </div>
        <button
          type="submit"
          disabled={submitting || invalid || cantAfford}
          className={buttonClass({ variant: 'primary', className: 'shrink-0' })}
        >
          {submitting ? 'spinning…' : cantAfford ? 'no funds' : 'Spin'}
        </button>
      </div>
      <p className="text-xs text-emerald-300/80">
        min ${min} · max ${max} · balance ${balance.toLocaleString()}
      </p>
    </fetcher.Form>
  );
}

function OutcomePanel({
  view,
  roomId,
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
  viewerName,
}: {
  view: SlotsView;
  roomId: string;
  isRoomCreator: boolean;
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';
  roomMaxSeats: number;
  viewerName: string;
}) {
  void viewerName;
  const slot = view.players[0];
  const won = slot && slot.winnings > 0;
  const label = slot?.payoutKind ? PAYOUT_LABEL[slot.payoutKind] : '';
  return (
    <div
      className={`rounded-xl px-6 py-5 ${won ? 'bg-yellow-400 text-slate-900' : 'bg-slate-800 text-white'} text-center shadow-lg`}
    >
      <p className="text-2xl font-bold uppercase tracking-wide">{label}</p>
      {slot && (
        <p className="mt-2 text-lg font-semibold tabular-nums">
          {won
            ? `+$${(slot.winnings - slot.stake).toLocaleString()}`
            : `−$${slot.stake.toLocaleString()}`}
        </p>
      )}
      <div className="mt-4 flex flex-col items-center gap-3">
        <GameSwitcher
          roomId={roomId}
          currentGame={roomGameType}
          maxSeats={roomMaxSeats}
          isRoomCreator={isRoomCreator}
        />
        {isRoomCreator ? (
          <SpinAgain roomId={roomId} />
        ) : (
          <p className="text-sm italic opacity-80">
            waiting for the room creator to start the next spin…
          </p>
        )}
        <Link to="/" className={buttonClass({ variant: 'neutral' })}>
          Landing
        </Link>
      </div>
    </div>
  );
}

function SpinAgain({ roomId }: { roomId: string }) {
  return (
    <Form method="post" action={`/rooms/${roomId}`} className="inline-block">
      <AuthenticityTokenInput />
      <input type="hidden" name="intent" value="start_hand" />
      <button type="submit" className={buttonClass({ variant: 'primary' })}>
        Spin Again
      </button>
    </Form>
  );
}
