import { useEffect, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import { buttonClass } from 'lib/buttonStyle';

type GameKind = 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';

const GAME_LABEL: Record<GameKind, string> = {
  blackjack: 'Blackjack',
  poker: '5-Card Draw',
  holdem: "Texas Hold'em",
  slots: 'Slots',
  roulette: 'Roulette',
};

const GAME_SEAT_RANGES: Record<GameKind, { min: number; max: number }> = {
  blackjack: { min: 1, max: 7 },
  poker: { min: 2, max: 9 },
  holdem: { min: 2, max: 9 },
  slots: { min: 1, max: 1 },
  roulette: { min: 1, max: 8 },
};

type GameSwitcherProps = {
  roomId: string;
  currentGame: GameKind;
  maxSeats: number;
  /** Only creators see the controls; everyone else sees the read-only label. */
  isRoomCreator: boolean;
};

const SUCCESS_FLASH_MS = 1800;

/**
 * Inline picker for the room's current game type. Renders as a read-only
 * line for non-creators ("Game: Blackjack"), and as a select+button for
 * the creator. Options that don't fit the room's seat count are disabled
 * with an inline reason.
 *
 * Submitting POSTs `intent=switch_game` to the current room route. The
 * action validates again server-side and refuses if a hand is in progress.
 */
export default function GameSwitcher({
  roomId,
  currentGame,
  maxSeats,
  isRoomCreator,
}: GameSwitcherProps) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';

  // The 204-with-redirect response Remix uses for fetcher actions has no
  // body, so we can't gate the success flash on fetcher.data. Instead we
  // detect the submitting → idle transition.
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

  if (!isRoomCreator) {
    return (
      <p className="text-xs uppercase tracking-wider text-emerald-200/80">
        Game: <span className="font-semibold text-white">{GAME_LABEL[currentGame]}</span>
      </p>
    );
  }

  return (
    <fetcher.Form
      method="post"
      action={`/rooms/${roomId}`}
      className="flex items-center gap-2 text-xs"
    >
      <AuthenticityTokenInput />
      <input type="hidden" name="intent" value="switch_game" />
      <label htmlFor="switch-game-type" className="uppercase tracking-wider text-emerald-200/80">
        Game
      </label>
      <select
        id="switch-game-type"
        name="gameType"
        defaultValue={currentGame}
        disabled={submitting}
        className="rounded bg-emerald-950 text-white border border-emerald-700 px-2 py-1 text-sm"
      >
        {(Object.keys(GAME_LABEL) as GameKind[]).map((g) => {
          const r = GAME_SEAT_RANGES[g];
          const fits = maxSeats >= r.min && maxSeats <= r.max;
          return (
            <option key={g} value={g} disabled={!fits}>
              {GAME_LABEL[g]}
              {!fits ? ` (needs ${r.min}–${r.max} seats)` : ''}
            </option>
          );
        })}
      </select>
      <button
        type="submit"
        disabled={submitting}
        className={buttonClass({
          variant: flash ? 'success' : 'neutral',
          size: 'sm',
        })}
      >
        {submitting ? '…' : flash ? '✓ Switched' : 'Switch'}
      </button>
    </fetcher.Form>
  );
}
