import { Form, Link, useFetcher } from '@remix-run/react';
import { useState } from 'react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import {
  BET_LABEL,
  BET_PAYOUT,
  isRed,
  type RouletteView,
  type BetKind,
} from 'engines/roulette/types';
import { buttonClass } from 'lib/buttonStyle';
import GameSwitcher from './GameSwitcher';
import Avatar from './Avatar';

type RouletteHandViewProps = {
  roomId: string;
  isRoomCreator: boolean;
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';
  roomMaxSeats: number;
  handSeatId: string | null;
  initialView: RouletteView;
  viewerName: string;
  viewerBalance: number;
  participants: Record<string, { name: string; isAi: boolean }>;
};

const OUTSIDE_BETS: BetKind[] = [
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'column1',
  'column2',
  'column3',
];

export default function RouletteHandView({
  roomId,
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
  handSeatId,
  initialView,
  viewerName,
  viewerBalance,
  participants,
}: RouletteHandViewProps) {
  const view = initialView;
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
        </div>

        <WheelDisplay result={view.result} />

        <div className="flex flex-col gap-2">
          {view.players.map((p) => {
            const owner = participants[p.id];
            const name = p.id === handSeatId ? viewerName : (owner?.name ?? p.id.slice(0, 8));
            const isAi = owner?.isAi ?? false;
            return <PlayerRow key={p.id} name={name} isAi={isAi} slot={p} />;
          })}
        </div>

        {view.phase === 'awaiting_bets' && isViewer && (
          <BetForm
            roomId={roomId}
            min={view.config.minimumBet}
            max={view.config.maximumBet}
            balance={viewerBalance}
          />
        )}

        {view.phase === 'awaiting_bets' && isRoomCreator && (
          <SpinForm roomId={roomId} disabled={view.players.every((p) => p.bets.length === 0)} />
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

function WheelDisplay({ result }: { result: number | null }) {
  const color =
    result === null
      ? 'bg-slate-700 text-slate-300'
      : result === 0
        ? 'bg-emerald-600 text-white'
        : isRed(result)
          ? 'bg-red-600 text-white'
          : 'bg-slate-900 text-white';
  return (
    <div className="rounded-xl bg-emerald-950/60 ring-1 ring-yellow-700/50 p-6 flex items-center justify-center">
      <div
        className={`flex items-center justify-center rounded-full ${color} ring-4 ring-yellow-300 shadow-2xl select-none`}
        style={{ width: 120, height: 120, fontSize: 48, fontWeight: 800 }}
        aria-label={result === null ? 'wheel awaiting spin' : `result ${result}`}
      >
        {result === null ? '?' : result}
      </div>
    </div>
  );
}

function PlayerRow({
  name,
  isAi,
  slot,
}: {
  name: string;
  isAi: boolean;
  slot: RouletteView['players'][number];
}) {
  return (
    <section className="rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 p-3 flex items-center gap-3">
      <Avatar name={name} isAi={isAi} size={40} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{name}</p>
        <p className="text-xs text-emerald-200/70 tabular-nums">
          staked ${slot.totalStake.toLocaleString()} · {slot.bets.length} bet
          {slot.bets.length === 1 ? '' : 's'}
          {slot.winnings > 0 && (
            <>
              {' · '}
              <span className="text-yellow-300 font-semibold">
                won ${slot.winnings.toLocaleString()}
              </span>
            </>
          )}
        </p>
      </div>
    </section>
  );
}

function BetForm({
  roomId,
  min,
  max,
  balance,
}: {
  roomId: string;
  min: number;
  max: number;
  balance: number;
}) {
  const fetcher = useFetcher();
  const [betKind, setBetKind] = useState<BetKind>('red');
  const [amount, setAmount] = useState<number>(min);
  const [number, setNumber] = useState<number>(0);
  const isStraight = betKind === 'straight';
  const submitting = fetcher.state !== 'idle';
  const invalid = amount < min || amount > max || amount > balance;

  return (
    <fetcher.Form
      method="post"
      action={`/rooms/${roomId}`}
      className="rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 p-4 space-y-3"
    >
      <AuthenticityTokenInput />
      <input type="hidden" name="submit" value="place_bet" />
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="bet-kind" className="text-xs uppercase tracking-wider text-emerald-200">
            Bet
          </label>
          <select
            id="bet-kind"
            name="betKind"
            value={betKind}
            onChange={(e) => setBetKind(e.target.value as BetKind)}
            className="rounded bg-emerald-950 text-white border border-emerald-700 px-2 py-2 text-sm"
          >
            <option value="straight">Straight (35:1)</option>
            {OUTSIDE_BETS.map((k) => (
              <option key={k} value={k}>
                {BET_LABEL[k]} ({BET_PAYOUT[k]}:1)
              </option>
            ))}
          </select>
        </div>

        {isStraight && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="bet-number"
              className="text-xs uppercase tracking-wider text-emerald-200"
            >
              Number
            </label>
            <input
              id="bet-number"
              type="number"
              name="number"
              min={0}
              max={36}
              value={number}
              onChange={(e) => setNumber(parseInt(e.target.value, 10) || 0)}
              className="w-20 rounded bg-emerald-950 text-white border border-emerald-700 px-2 py-2 text-sm tabular-nums"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="bet-amount" className="text-xs uppercase tracking-wider text-emerald-200">
            Amount
          </label>
          <input
            id="bet-amount"
            type="number"
            name="amount"
            min={min}
            max={Math.min(max, balance)}
            step={1}
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            className="w-24 rounded bg-emerald-950 text-white border border-emerald-700 px-2 py-2 text-sm tabular-nums"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || invalid}
          className={buttonClass({ variant: 'warning' })}
        >
          {submitting ? '…' : 'Place'}
        </button>
      </div>
      <p className="text-xs text-emerald-300/80">
        min ${min} · max ${max} · balance ${balance.toLocaleString()}
      </p>
    </fetcher.Form>
  );
}

function SpinForm({ roomId, disabled }: { roomId: string; disabled: boolean }) {
  return (
    <Form method="post" action={`/rooms/${roomId}`} className="flex justify-center">
      <AuthenticityTokenInput />
      <input type="hidden" name="submit" value="spin" />
      <button type="submit" disabled={disabled} className={buttonClass({ variant: 'primary' })}>
        Spin the Wheel
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
  view: RouletteView;
  roomId: string;
  isRoomCreator: boolean;
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';
  roomMaxSeats: number;
  viewerSlotId: string | null;
}) {
  const viewerSlot = view.players.find((p) => p.id === viewerSlotId);
  const won = viewerSlot && viewerSlot.winnings > viewerSlot.totalStake;
  const net = viewerSlot ? viewerSlot.winnings - viewerSlot.totalStake : 0;
  return (
    <div
      className={`rounded-xl px-6 py-5 ${won ? 'bg-yellow-400 text-slate-900' : 'bg-slate-800 text-white'} text-center shadow-lg`}
    >
      <p className="text-2xl font-bold uppercase tracking-wide">
        {view.result !== null ? `Result: ${view.result}` : 'Hand over'}
      </p>
      {viewerSlot && (
        <p className="mt-2 text-lg font-semibold tabular-nums">
          {net >= 0 ? `+$${net.toLocaleString()}` : `−$${Math.abs(net).toLocaleString()}`}
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
          <Form method="post" action={`/rooms/${roomId}`} className="inline-block">
            <AuthenticityTokenInput />
            <input type="hidden" name="intent" value="start_hand" />
            <button type="submit" className={buttonClass({ variant: 'primary' })}>
              Start Next Round
            </button>
          </Form>
        ) : (
          <p className="text-sm italic opacity-80">
            waiting for the room creator to start the next round…
          </p>
        )}
        <Link to="/" className={buttonClass({ variant: 'neutral' })}>
          Landing
        </Link>
      </div>
    </div>
  );
}
