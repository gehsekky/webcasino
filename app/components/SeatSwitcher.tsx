import { useEffect, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import { buttonClass } from 'lib/buttonStyle';

type GameKind = 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette' | 'baccarat';

// Mirrors `GAME_SEAT_RANGES` in `actions/tableLifecycle.server.ts`. Kept
// inline so this component doesn't have to import server-only code.
const GAME_SEAT_RANGES: Record<GameKind, { min: number; max: number }> = {
  blackjack: { min: 1, max: 7 },
  poker: { min: 2, max: 9 },
  holdem: { min: 2, max: 9 },
  slots: { min: 1, max: 1 },
  roulette: { min: 1, max: 8 },
  baccarat: { min: 1, max: 7 },
};

type SeatSwitcherProps = {
  roomId: string;
  currentGame: GameKind;
  /** Current `casino_table.max_seats`. */
  maxSeats: number;
  /** Count of persistent seats currently occupied — input can't go below this. */
  seatedCount: number;
  /** Only creators see the controls; everyone else sees the read-only label. */
  isRoomCreator: boolean;
};

const SUCCESS_FLASH_MS = 1800;

/**
 * Inline editor for `casino_table.max_seats`. Renders read-only for
 * non-creators and for slots rooms (slots is fixed-seat). Otherwise a
 * number input bounded by the current game's seat range and the
 * room's seated-count floor.
 *
 * Submitting POSTs `intent=change_max_seats` to the current room
 * route. The server validates again — refuses mid-hand, refuses below
 * the seated count, refuses outside the game's range.
 */
export default function SeatSwitcher({
  roomId,
  currentGame,
  maxSeats,
  seatedCount,
  isRoomCreator,
}: SeatSwitcherProps) {
  const range = GAME_SEAT_RANGES[currentGame];
  // Slots is locked at 1 — show as read-only for everyone.
  const isFixed = range.min === range.max;

  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';
  const [flash, setFlash] = useState(false);
  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (wasSubmitting.current && fetcher.state === 'idle') {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), SUCCESS_FLASH_MS);
      return () => clearTimeout(t);
    }
    wasSubmitting.current = fetcher.state !== 'idle';
  }, [fetcher.state]);

  // Effective lower bound: must satisfy game's `range.min`, and must
  // not drop below the current seated count.
  const effectiveMin = Math.max(range.min, seatedCount);

  if (!isRoomCreator || isFixed) {
    const suffix = isFixed ? ' (fixed for slots)' : '';
    return (
      <p className="text-xs uppercase tracking-wider text-emerald-200/80">
        Seats: <span className="font-semibold text-white tabular-nums">{maxSeats}</span>
        <span className="text-emerald-200/60 normal-case font-normal">{suffix}</span>
      </p>
    );
  }

  return (
    <fetcher.Form
      method="post"
      action={`/rooms/${roomId}`}
      className="flex items-center gap-2 text-xs"
      onSubmit={(e) => {
        // Only confirm on reduction. The input's `min` already blocks
        // dropping below the seated count, so a shrink here only retires
        // empty AI-fill capacity — still worth a prompt since it changes
        // the table's shape.
        const form = e.currentTarget;
        const requested = parseInt(
          (form.elements.namedItem('maxSeats') as HTMLInputElement | null)?.value ?? '',
          10,
        );
        if (Number.isFinite(requested) && requested < maxSeats) {
          if (!window.confirm(`Reduce seats from ${maxSeats} to ${requested}?`)) {
            e.preventDefault();
          }
        }
      }}
    >
      <AuthenticityTokenInput />
      <input type="hidden" name="intent" value="change_max_seats" />
      <label htmlFor="seat-switcher-input" className="uppercase tracking-wider text-emerald-200/80">
        Seats
      </label>
      <input
        id="seat-switcher-input"
        name="maxSeats"
        type="number"
        min={effectiveMin}
        max={range.max}
        step={1}
        defaultValue={maxSeats}
        disabled={submitting}
        aria-describedby="seat-switcher-bounds"
        className="w-16 rounded bg-emerald-950 text-white border border-emerald-700 px-2 py-1 text-sm tabular-nums"
      />
      <button
        type="submit"
        disabled={submitting}
        className={buttonClass({
          variant: flash ? 'success' : 'neutral',
          size: 'sm',
        })}
      >
        {submitting ? '…' : flash ? '✓ Saved' : 'Save'}
      </button>
      <span id="seat-switcher-bounds" className="text-emerald-200/60 normal-case">
        {range.min}–{range.max}
        {seatedCount > range.min ? ` · ${seatedCount} seated` : ''}
      </span>
    </fetcher.Form>
  );
}
