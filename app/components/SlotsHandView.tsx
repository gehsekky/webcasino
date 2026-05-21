import { Form, Link, useFetcher } from '@remix-run/react';
import { useEffect, useMemo, useState } from 'react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import {
  SLOT_SYMBOL_GLYPH,
  SLOT_SYMBOLS,
  type SlotsSymbol,
  type SlotsView,
} from 'engines/slots/types';
import { useSlotsView } from 'hooks/useSlotsView';
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
  // Slots is single-seat, so SSE updates rarely add anything beyond what
  // the post-submit revalidation already shows. We subscribe anyway for
  // shape consistency with the other game views — keeps the door open
  // for spectator viewing later.
  const { view, status } = useSlotsView(roomId, initialView);
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
          <ConnectionStatus status={status} />
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

/**
 * One reel strip is 21 cells × 6rem each = 126rem tall. The animation
 * keyframe in tailwind.css translates from -120rem (last filler at the
 * window) to 0 (target at the window). Keep these in sync if you change
 * either side.
 */
const STRIP_LENGTH = 21;
const CELL_REM = 6;
/** Staggered durations per reel — leftmost stops first, rightmost last. */
const REEL_DURATIONS_MS = [1100, 1500, 1900];

function buildStrip(target: SlotsSymbol): SlotsSymbol[] {
  // Target on top (visible at the end of the animation); 20 cycling
  // fillers below for the blur. Deterministic so SSR and CSR match.
  const cells: SlotsSymbol[] = [target];
  for (let i = 0; i < STRIP_LENGTH - 1; i++) {
    cells.push(SLOT_SYMBOLS[(i * 3 + 1) % SLOT_SYMBOLS.length]);
  }
  return cells;
}

function ReelDisplay({ view }: { view: SlotsView }) {
  const reels = view.players[0]?.reels ?? [];
  return (
    <div className="rounded-xl bg-emerald-950/60 ring-1 ring-yellow-700/50 p-6 flex items-center justify-center gap-4">
      {[0, 1, 2].map((i) => (
        <Reel
          key={i}
          target={(reels[i] as SlotsSymbol | undefined) ?? null}
          durationMs={REEL_DURATIONS_MS[i]}
        />
      ))}
    </div>
  );
}

function Reel({ target, durationMs }: { target: SlotsSymbol | null; durationMs: number }) {
  const strip = useMemo(() => (target ? buildStrip(target) : null), [target]);

  return (
    <div
      className="w-24 h-24 rounded-lg bg-white ring-2 ring-yellow-300 shadow-inner overflow-hidden select-none"
      aria-label={target ?? 'empty reel'}
      role="img"
    >
      {strip ? (
        <div
          style={{
            animation: `reel-spin-down ${durationMs}ms cubic-bezier(0.15, 0.65, 0.25, 1) forwards`,
            willChange: 'transform',
          }}
        >
          {strip.map((sym, i) => (
            <div
              key={i}
              className="flex items-center justify-center text-6xl text-slate-900"
              style={{ width: `${CELL_REM}rem`, height: `${CELL_REM}rem` }}
            >
              {SLOT_SYMBOL_GLYPH[sym]}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center w-full h-full text-6xl text-slate-300">
          ?
        </div>
      )}
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
            aria-describedby="slots-bounds"
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
      <p id="slots-bounds" className="text-xs text-emerald-300/80">
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
          tone={won ? 'light' : 'dark'}
        />
        {isRoomCreator ? (
          <SpinAgain roomId={roomId} winning={won ?? false} />
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

function SpinAgain({ roomId, winning }: { roomId: string; winning: boolean }) {
  return (
    <Form method="post" action={`/rooms/${roomId}`} className="inline-block">
      <AuthenticityTokenInput />
      <input type="hidden" name="intent" value="start_hand" />
      <button
        type="submit"
        className={buttonClass({
          variant: winning ? 'success' : 'primary',
          tone: winning ? 'light' : 'dark',
        })}
      >
        Spin Again
      </button>
    </Form>
  );
}
