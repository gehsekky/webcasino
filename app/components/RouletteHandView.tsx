import { Form, Link, useFetcher } from '@remix-run/react';
import { useMemo, useState } from 'react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import {
  BET_LABEL,
  BET_PAYOUT,
  isRed,
  type RouletteBet,
  type RouletteView,
  type BetKind,
} from 'engines/roulette/types';
import { useRouletteView } from 'hooks/useRouletteView';
import { buttonClass } from 'lib/buttonStyle';
import GameSwitcher from './GameSwitcher';
import Avatar from './Avatar';
import ConnectionStatus from './ConnectionStatus';

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

/**
 * Number cells in the standard betting-board orientation (3 rows × 12
 * columns, left-to-right, top-to-bottom):
 *   row 0 (top):    3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36   (column 3)
 *   row 1 (middle): 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35   (column 2)
 *   row 2 (bottom): 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34   (column 1)
 */
const NUMBER_ROWS: number[][] = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];
/** Column bet kind per row of the number grid (top → bottom). */
const COLUMN_BET_FOR_ROW: BetKind[] = ['column3', 'column2', 'column1'];

type SelectedBet = { kind: BetKind; number?: number };

function sameBet(a: SelectedBet | null, b: SelectedBet): boolean {
  return a !== null && a.kind === b.kind && a.number === b.number;
}

function describeBet(b: SelectedBet): string {
  if (b.kind === 'straight') return `Straight ${b.number}`;
  return BET_LABEL[b.kind];
}

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
  const { view, status } = useRouletteView(roomId, initialView);
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

        <WheelDisplay result={view.result} />

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

/**
 * Wheel cell layout: 41-cell strip × 7.5rem each = 307.5rem tall. The
 * `wheel-spin-down` keyframe translates from -300rem (showing the bottom
 * filler) to 0 (showing the top cell = the result). Keep these in sync
 * with the keyframe in tailwind.css.
 */
const WHEEL_STRIP_LENGTH = 41;
const WHEEL_CELL_REM = 7.5;
const WHEEL_DIAMETER_PX = 120;
const WHEEL_SPIN_MS = 2400;

function colorForPocket(n: number): string {
  if (n === 0) return 'bg-emerald-600 text-white';
  if (isRed(n)) return 'bg-red-600 text-white';
  return 'bg-slate-900 text-white';
}

function buildWheelStrip(result: number): number[] {
  // Result on top (visible at end of animation); 40 cycling fillers below
  // using a prime stride so the same number rarely repeats consecutively.
  // Deterministic so SSR and CSR render the same DOM.
  const cells: number[] = [result];
  for (let i = 0; i < WHEEL_STRIP_LENGTH - 1; i++) {
    cells.push((i * 7 + 3) % 37);
  }
  return cells;
}

function WheelDisplay({ result }: { result: number | null }) {
  if (result === null) {
    return (
      <div className="rounded-xl bg-emerald-950/60 ring-1 ring-yellow-700/50 p-6 flex items-center justify-center">
        <div
          className="flex items-center justify-center rounded-full bg-slate-700 text-slate-300 ring-4 ring-yellow-300 shadow-2xl select-none"
          style={{
            width: WHEEL_DIAMETER_PX,
            height: WHEEL_DIAMETER_PX,
            fontSize: 48,
            fontWeight: 800,
          }}
          aria-label="wheel awaiting spin"
        >
          ?
        </div>
      </div>
    );
  }
  return <SpinningWheel result={result} />;
}

function SpinningWheel({ result }: { result: number }) {
  const strip = useMemo(() => buildWheelStrip(result), [result]);
  const finalColor = colorForPocket(result);

  return (
    <div className="rounded-xl bg-emerald-950/60 ring-1 ring-yellow-700/50 p-6 flex items-center justify-center">
      <div
        className={`relative rounded-full ${finalColor} ring-4 ring-yellow-300 shadow-2xl select-none overflow-hidden`}
        style={{ width: WHEEL_DIAMETER_PX, height: WHEEL_DIAMETER_PX }}
        aria-label={`result ${result}`}
        role="img"
      >
        <div
          style={{
            animation: `wheel-spin-down ${WHEEL_SPIN_MS}ms cubic-bezier(0.18, 0.7, 0.22, 1) forwards`,
            willChange: 'transform',
          }}
        >
          {strip.map((n, i) => (
            <div
              key={i}
              className={`flex items-center justify-center font-extrabold ${colorForPocket(n)}`}
              style={{
                width: WHEEL_DIAMETER_PX,
                height: `${WHEEL_CELL_REM}rem`,
                fontSize: 48,
              }}
            >
              {n}
            </div>
          ))}
        </div>
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
  viewerSlot,
}: {
  roomId: string;
  min: number;
  max: number;
  balance: number;
  viewerSlot: RouletteView['players'][number];
}) {
  const fetcher = useFetcher();
  const [selected, setSelected] = useState<SelectedBet | null>(null);
  const [amount, setAmount] = useState<number>(min);
  const submitting = fetcher.state !== 'idle';
  const invalid = !selected || amount < min || amount > max || amount > balance;

  return (
    <fetcher.Form
      method="post"
      action={`/rooms/${roomId}`}
      className="rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 p-3 space-y-3"
    >
      <AuthenticityTokenInput />
      <input type="hidden" name="submit" value="place_bet" />
      <input type="hidden" name="betKind" value={selected?.kind ?? ''} />
      <input type="hidden" name="number" value={selected?.number ?? ''} />

      <BettingBoard selected={selected} onSelect={setSelected} />

      <ActiveBetsList bets={viewerSlot.bets} totalStake={viewerSlot.totalStake} />

      <div className="flex flex-wrap items-end gap-3 pt-1">
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
          {submitting ? '…' : selected ? `Place — ${describeBet(selected)}` : 'Select a bet'}
        </button>

        <p className="text-xs text-emerald-300/80 ml-auto">
          min ${min} · max ${max} · balance ${balance.toLocaleString()}
        </p>
      </div>
    </fetcher.Form>
  );
}

/**
 * Visible inventory of the viewer's bets for the current round, so they
 * can see at-a-glance what they've already placed before adding more
 * (helps avoid accidentally double-betting the same kind). Each line is
 * one bet row; clicking the same cell twice and submitting twice creates
 * two separate bets — that's the engine contract today. A future
 * "consolidate matching bets" affordance would live here too.
 */
function ActiveBetsList({ bets, totalStake }: { bets: RouletteBet[]; totalStake: number }) {
  if (bets.length === 0) return null;
  return (
    <section
      aria-labelledby="active-bets-heading"
      className="rounded-lg bg-emerald-950/40 ring-1 ring-emerald-800/40 p-3 text-sm"
    >
      <h3
        id="active-bets-heading"
        className="text-xs uppercase tracking-wider text-emerald-200/80 mb-2"
      >
        Your bets
      </h3>
      <ul className="space-y-1">
        {bets.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 text-emerald-100">
            <span className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden="true"
                className={`shrink-0 w-3 h-3 rounded-full ${swatchForBet(b)}`}
              />
              <span className="truncate">{describeBetRow(b)}</span>
            </span>
            <span className="font-semibold tabular-nums shrink-0">
              ${b.amount.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 pt-2 border-t border-emerald-800/40 flex justify-between text-xs">
        <span className="text-emerald-200/80 uppercase tracking-wide">Total staked</span>
        <span className="font-semibold text-white tabular-nums">
          ${totalStake.toLocaleString()}
        </span>
      </div>
    </section>
  );
}

function swatchForBet(b: RouletteBet): string {
  if (b.kind === 'straight') {
    if (b.number === 0) return 'bg-emerald-600';
    if (b.number !== undefined && isRed(b.number)) return 'bg-red-600';
    return 'bg-slate-900';
  }
  if (b.kind === 'red') return 'bg-red-600';
  if (b.kind === 'black') return 'bg-slate-900';
  // Outside / dozen / column — use a neutral chip.
  return 'bg-emerald-700';
}

function describeBetRow(b: RouletteBet): string {
  if (b.kind === 'straight') return `Straight ${b.number}`;
  // Append payout odds for outside/dozen/column bets so the user sees
  // what they're betting against without having to remember the table.
  return `${BET_LABEL[b.kind]} (${BET_PAYOUT[b.kind]}:1)`;
}

function BettingBoard({
  selected,
  onSelect,
}: {
  selected: SelectedBet | null;
  onSelect: (b: SelectedBet) => void;
}) {
  return (
    <div className="overflow-x-auto">
      {/* Outer grid: [0-cell col] + [12 number cols] + [2:1 col]. Rows: 3
          number rows, then a column-bet row, then dozens, then outside
          bets. Min width keeps cells readable on narrow viewports. */}
      <div
        className="grid gap-0.5 min-w-[42rem] text-xs font-semibold select-none"
        style={{
          gridTemplateColumns: '2.5rem repeat(12, minmax(0, 1fr)) 2.5rem',
        }}
      >
        {/* Zero cell — spans all 3 number rows. */}
        <button
          type="button"
          onClick={() => onSelect({ kind: 'straight', number: 0 })}
          className={cellClass(
            'bg-emerald-700 hover:bg-emerald-600 text-white',
            sameBet(selected, { kind: 'straight', number: 0 }),
          )}
          style={{ gridRow: 'span 3', height: 'auto' }}
        >
          0
        </button>

        {/* Three rows of numbers; per-row 2:1 column-bet trigger on the right. */}
        {NUMBER_ROWS.map((row, rowIdx) => (
          <NumberRow
            key={rowIdx}
            row={row}
            columnBet={COLUMN_BET_FOR_ROW[rowIdx]}
            selected={selected}
            onSelect={onSelect}
          />
        ))}

        {/* Dozens row — col-start 2, each spans 4 of the 12 number cols. */}
        <BoardCell
          kind="dozen1"
          label="1st 12"
          selected={selected}
          onSelect={onSelect}
          style={{ gridColumn: '2 / span 4' }}
        />
        <BoardCell
          kind="dozen2"
          label="2nd 12"
          selected={selected}
          onSelect={onSelect}
          style={{ gridColumn: '6 / span 4' }}
        />
        <BoardCell
          kind="dozen3"
          label="3rd 12"
          selected={selected}
          onSelect={onSelect}
          style={{ gridColumn: '10 / span 4' }}
        />

        {/* Outside bets row — 6 cells across the 12 number cols. */}
        <BoardCell
          kind="low"
          label="1-18"
          selected={selected}
          onSelect={onSelect}
          style={{ gridColumn: '2 / span 2' }}
        />
        <BoardCell
          kind="even"
          label="EVEN"
          selected={selected}
          onSelect={onSelect}
          style={{ gridColumn: '4 / span 2' }}
        />
        <BoardCell
          kind="red"
          label="RED"
          selected={selected}
          onSelect={onSelect}
          colorClass="bg-red-700 hover:bg-red-600 text-white"
          style={{ gridColumn: '6 / span 2' }}
        />
        <BoardCell
          kind="black"
          label="BLACK"
          selected={selected}
          onSelect={onSelect}
          colorClass="bg-slate-900 hover:bg-slate-800 text-white"
          style={{ gridColumn: '8 / span 2' }}
        />
        <BoardCell
          kind="odd"
          label="ODD"
          selected={selected}
          onSelect={onSelect}
          style={{ gridColumn: '10 / span 2' }}
        />
        <BoardCell
          kind="high"
          label="19-36"
          selected={selected}
          onSelect={onSelect}
          style={{ gridColumn: '12 / span 2' }}
        />
      </div>
    </div>
  );
}

function NumberRow({
  row,
  columnBet,
  selected,
  onSelect,
}: {
  row: number[];
  columnBet: BetKind;
  selected: SelectedBet | null;
  onSelect: (b: SelectedBet) => void;
}) {
  return (
    <>
      {row.map((n) => {
        const isSelected = sameBet(selected, { kind: 'straight', number: n });
        const colorClass = isRed(n)
          ? 'bg-red-700 hover:bg-red-600 text-white'
          : 'bg-slate-900 hover:bg-slate-800 text-white';
        return (
          <button
            key={n}
            type="button"
            onClick={() => onSelect({ kind: 'straight', number: n })}
            className={cellClass(colorClass, isSelected)}
          >
            {n}
          </button>
        );
      })}
      <BoardCell
        kind={columnBet}
        label="2:1"
        selected={selected}
        onSelect={onSelect}
        title={`Column bet — pays ${BET_PAYOUT[columnBet]}:1`}
      />
    </>
  );
}

function BoardCell({
  kind,
  label,
  selected,
  onSelect,
  colorClass = 'bg-emerald-950/80 hover:bg-emerald-800 text-emerald-100 ring-1 ring-emerald-700/40',
  title,
  style,
}: {
  kind: BetKind;
  label: string;
  selected: SelectedBet | null;
  onSelect: (b: SelectedBet) => void;
  colorClass?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  const isSelected = sameBet(selected, { kind });
  return (
    <button
      type="button"
      onClick={() => onSelect({ kind })}
      className={cellClass(colorClass, isSelected)}
      title={title}
      style={style}
    >
      {label}
    </button>
  );
}

function cellClass(colorClass: string, selected: boolean): string {
  return [
    'flex items-center justify-center h-10 rounded transition-colors',
    colorClass,
    selected ? 'ring-2 ring-yellow-300 ring-offset-1 ring-offset-emerald-900' : '',
  ]
    .filter(Boolean)
    .join(' ');
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
