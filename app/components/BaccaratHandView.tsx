import { useEffect, useState } from 'react';
import { Form, Link, useFetcher } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import type { BaccaratBet, BaccaratView } from 'engines/baccarat/types';
import { BACCARAT_BET_LABEL, handTotal } from 'engines/baccarat/types';
import { useBaccaratView } from 'hooks/useBaccaratView';
import { buttonClass } from 'lib/buttonStyle';
import PlayingCard from './PlayingCard';
import ConnectionStatus from './ConnectionStatus';
import GameSwitcher from './GameSwitcher';
import Avatar from './Avatar';

type BaccaratHandViewProps = {
  roomId: string;
  isRoomCreator: boolean;
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette' | 'baccarat';
  roomMaxSeats: number;
  /** Null when the viewer joined mid-hand and is spectating. */
  handSeatId: string | null;
  initialView: BaccaratView;
  viewerName: string;
  viewerBalance: number;
  participants: Record<string, { name: string; isAi: boolean }>;
};

const LAST_AMOUNT_STORAGE_KEY = 'webcasino:lastBaccaratAmount';

export default function BaccaratHandView({
  roomId,
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
  handSeatId,
  initialView,
  viewerName,
  viewerBalance,
  participants,
}: BaccaratHandViewProps) {
  const { view, status } = useBaccaratView(roomId, initialView);
  const viewerSlot = view.players.find((p) => p.id === handSeatId);
  const isViewer = !!viewerSlot;

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
            {view.phase === 'settled' ? 'Result' : 'Place your bets'}
          </span>
          <span className="text-xs uppercase tracking-wider text-emerald-200/70 tabular-nums">
            Balance: ${viewerBalance.toLocaleString()}
          </span>
          <ConnectionStatus status={status} />
        </div>

        {/* The two hands side-by-side, with running totals once cards land. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <HandPanel
            label="Player"
            cards={view.playerHand}
            total={view.playerTotal}
            winning={view.outcome === 'player'}
          />
          <HandPanel
            label="Banker"
            cards={view.bankerHand}
            total={view.bankerTotal}
            winning={view.outcome === 'banker'}
          />
        </div>

        {/* Every seat at the table with their bets, so multi-player tables
            can see who's bet on what. */}
        <div className="flex flex-col gap-2">
          {view.players.map((p) => {
            const owner = participants[p.id];
            const name = p.id === handSeatId ? viewerName : (owner?.name ?? p.id.slice(0, 8));
            const isAi = owner?.isAi ?? false;
            return <PlayerRow key={p.id} name={name} isAi={isAi} slot={p} />;
          })}
        </div>

        {view.phase === 'awaiting_bets' && isViewer && viewerSlot && (
          <BetForm
            roomId={roomId}
            min={view.config.minimumBet}
            max={view.config.maximumBet}
            balance={viewerBalance}
            viewerSlot={viewerSlot}
            tiePayout={view.config.tiePayout}
          />
        )}

        {view.phase === 'awaiting_bets' && isRoomCreator && (
          <DealForm roomId={roomId} disabled={view.players.every((p) => p.bets.length === 0)} />
        )}

        {view.phase === 'settled' && (
          <SettledPanel
            view={view}
            roomId={roomId}
            isRoomCreator={isRoomCreator}
            roomGameType={roomGameType}
            roomMaxSeats={roomMaxSeats}
            viewerSlotId={handSeatId}
          />
        )}
      </div>
    </main>
  );
}

function HandPanel({
  label,
  cards,
  total,
  winning,
}: {
  label: string;
  cards: BaccaratView['playerHand'];
  total: number | null;
  winning: boolean;
}) {
  const showTotal = cards.length >= 2;
  return (
    <section
      aria-label={`${label} hand`}
      className={`rounded-xl p-4 ring-1 ${
        winning
          ? 'bg-yellow-500/20 ring-yellow-400 shadow-lg shadow-yellow-500/20'
          : 'bg-emerald-900/40 ring-emerald-700/40'
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-200">{label}</h3>
        {showTotal && total !== null && (
          <span className="text-lg font-bold text-white tabular-nums">{total}</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 min-h-[6rem] items-center">
        {cards.length === 0 ? (
          <p className="text-sm italic text-emerald-200/60">no cards yet</p>
        ) : (
          cards.map((c, i) => <PlayingCard key={`${label}-${i}`} card={c} />)
        )}
      </div>
      {/* Live "running total" while cards are landing — only useful between
          the two-card deal and any third card; the totals after are shown
          above. We approximate by recomputing the partial total from the
          cards we have. */}
      {cards.length > 0 && total === null && (
        <p className="mt-2 text-xs text-emerald-200/70 tabular-nums">running: {handTotal(cards)}</p>
      )}
    </section>
  );
}

function PlayerRow({
  name,
  isAi,
  slot,
}: {
  name: string;
  isAi: boolean;
  slot: BaccaratView['players'][number];
}) {
  const total = slot.totalStake;
  const net = slot.winnings - total;
  return (
    <div className="flex items-center gap-3 rounded bg-emerald-950/60 px-3 py-2">
      <Avatar name={name} isAi={isAi} size={32} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{name}</p>
        {slot.bets.length === 0 ? (
          <p className="text-xs italic text-emerald-200/50">no bets yet</p>
        ) : (
          <p className="text-xs text-emerald-200/70 tabular-nums">
            {slot.bets.length} bet{slot.bets.length === 1 ? '' : 's'} · staked ${total}
          </p>
        )}
      </div>
      {slot.winnings > 0 && (
        <span
          className={`text-sm font-bold tabular-nums ${
            net > 0 ? 'text-yellow-300' : 'text-emerald-200'
          }`}
        >
          {net > 0 ? `+$${net}` : net === 0 ? 'push' : ''}
        </span>
      )}
    </div>
  );
}

function BetForm({
  roomId,
  min,
  max,
  balance,
  viewerSlot,
  tiePayout,
}: {
  roomId: string;
  min: number;
  max: number;
  balance: number;
  viewerSlot: BaccaratView['players'][number];
  tiePayout: number;
}) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';
  const [amount, setAmount] = useState<number>(min);

  // Restore the last amount the user staked, like the roulette form.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(LAST_AMOUNT_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed)) {
      const cap = Math.min(max, balance);
      setAmount(Math.min(Math.max(parsed, min), cap));
    }
  }, [min, max, balance]);

  const invalid = amount < min || amount > max || amount > balance;

  function persistAmount() {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_AMOUNT_STORAGE_KEY, String(amount));
  }

  return (
    <div className="rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 p-4 space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="baccarat-amount"
            className="text-xs uppercase tracking-wider text-emerald-200"
          >
            Amount
          </label>
          <input
            id="baccarat-amount"
            type="number"
            min={min}
            max={Math.min(max, balance)}
            step={1}
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            aria-describedby="baccarat-bounds"
            className="w-24 rounded bg-emerald-950 text-white border border-emerald-700 px-2 py-2 text-sm tabular-nums"
          />
        </div>
        <p id="baccarat-bounds" className="text-xs text-emerald-300/80 ml-auto">
          min ${min} · max ${max} · balance ${balance.toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(['player', 'banker', 'tie'] as const).map((kind) => (
          <fetcher.Form
            key={kind}
            method="post"
            action={`/rooms/${roomId}`}
            onSubmit={persistAmount}
          >
            <AuthenticityTokenInput />
            <input type="hidden" name="submit" value="place_bet" />
            <input type="hidden" name="betKind" value={kind} />
            <input type="hidden" name="amount" value={amount} />
            <button
              type="submit"
              disabled={submitting || invalid}
              className={buttonClass({
                variant: kind === 'tie' ? 'warning' : kind === 'banker' ? 'success' : 'primary',
                className: 'w-full',
              })}
              title={`${BACCARAT_BET_LABEL[kind]} bet — pays ${
                kind === 'tie' ? `${tiePayout}:1` : kind === 'banker' ? '0.95:1' : '1:1'
              }`}
            >
              {BACCARAT_BET_LABEL[kind]}
            </button>
          </fetcher.Form>
        ))}
      </div>

      {viewerSlot.bets.length > 0 && (
        <ActiveBetsList bets={viewerSlot.bets} totalStake={viewerSlot.totalStake} />
      )}
    </div>
  );
}

function ActiveBetsList({ bets, totalStake }: { bets: BaccaratBet[]; totalStake: number }) {
  return (
    <div className="rounded bg-emerald-950/40 ring-1 ring-emerald-700/40 p-3">
      <div className="flex items-baseline justify-between text-xs uppercase tracking-wider text-emerald-200/70">
        <span>Your bets</span>
        <span className="tabular-nums">total ${totalStake}</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {bets.map((b) => (
          <li key={b.id} className="flex items-center justify-between">
            <span className="text-white">{BACCARAT_BET_LABEL[b.kind]}</span>
            <span className="tabular-nums text-emerald-200">${b.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DealForm({ roomId, disabled }: { roomId: string; disabled: boolean }) {
  return (
    <Form method="post" action={`/rooms/${roomId}`} className="flex justify-center">
      <AuthenticityTokenInput />
      <input type="hidden" name="submit" value="deal" />
      <button
        type="submit"
        disabled={disabled}
        className={buttonClass({ variant: 'primary' })}
        aria-label="Deal the next hand"
      >
        Deal
      </button>
    </Form>
  );
}

function SettledPanel({
  view,
  roomId,
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
  viewerSlotId,
}: {
  view: BaccaratView;
  roomId: string;
  isRoomCreator: boolean;
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette' | 'baccarat';
  roomMaxSeats: number;
  viewerSlotId: string | null;
}) {
  const viewerSlot = view.players.find((p) => p.id === viewerSlotId);
  const net = viewerSlot ? viewerSlot.winnings - viewerSlot.totalStake : 0;
  const won = net > 0;
  const outcome = view.outcome;

  const outcomeLabel =
    outcome === 'player' ? 'Player wins' : outcome === 'banker' ? 'Banker wins' : 'Tie';

  return (
    <div
      className={`rounded-xl px-6 py-5 text-center shadow-lg ${
        won
          ? 'bg-yellow-400 text-slate-900'
          : net < 0
            ? 'bg-red-700 text-white'
            : 'bg-slate-700 text-white'
      }`}
    >
      <p className="text-2xl font-bold uppercase tracking-wide">{outcomeLabel}</p>
      <p className="mt-1 text-sm opacity-80 tabular-nums">
        Player {view.playerTotal} · Banker {view.bankerTotal}
      </p>
      {viewerSlot && (
        <p className="mt-2 text-lg font-semibold tabular-nums">
          {net > 0 ? `+$${net.toLocaleString()}` : net < 0 ? `−$${Math.abs(net)}` : 'bet returned'}
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
          <Form method="post" action={`/rooms/${roomId}`} className="inline-block">
            <AuthenticityTokenInput />
            <input type="hidden" name="intent" value="start_hand" />
            <button
              type="submit"
              className={buttonClass({
                variant: won ? 'success' : 'primary',
                tone: won ? 'light' : 'dark',
              })}
            >
              Start Next Hand
            </button>
          </Form>
        ) : (
          <p className="text-sm italic opacity-80">
            waiting for the room creator to start the next hand…
          </p>
        )}
        <Link to="/" className={buttonClass({ variant: 'neutral' })}>
          Landing
        </Link>
      </div>
    </div>
  );
}
