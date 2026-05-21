import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import { buttonClass } from 'lib/buttonStyle';

type CreateGameModalProps = {
  open: boolean;
  onClose: () => void;
};

type StakesPreset = 'low' | 'high' | 'custom';

const STAKES_BOUNDS: Record<Exclude<StakesPreset, 'custom'>, { min: number; max: number }> = {
  low: { min: 1, max: 100 },
  high: { min: 100, max: 10_000 },
};

/**
 * Game creation modal. Mounts as a fixed-position overlay; the parent
 * controls visibility via `open`. Submits as a Remix fetcher form so the
 * page redirects to the new room on success.
 */
const ROOM_NAME_MAX_LENGTH = 128;

export default function CreateGameModal({ open, onClose }: CreateGameModalProps) {
  const fetcher = useFetcher();
  const [name, setName] = useState('');
  const [gameType, setGameType] = useState<
    'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette' | 'baccarat'
  >('blackjack');
  const [numSeats, setNumSeats] = useState(3);
  const [stakes, setStakes] = useState<StakesPreset>('low');
  const [customMin, setCustomMin] = useState(1);
  const [customMax, setCustomMax] = useState(100);

  if (!open) return null;

  const submitting = fetcher.state !== 'idle';
  // Per-game seat ranges. Must mirror tableLifecycle.server.GAME_SEAT_RANGES.
  const SEAT_RANGE = {
    blackjack: { min: 1, max: 7 },
    poker: { min: 2, max: 9 },
    holdem: { min: 2, max: 9 },
    slots: { min: 1, max: 1 },
    roulette: { min: 1, max: 8 },
    baccarat: { min: 1, max: 7 },
  } as const;
  const minSeats = SEAT_RANGE[gameType].min;
  const maxSeats = SEAT_RANGE[gameType].max;
  const effectiveSeats = Math.min(Math.max(numSeats, minSeats), maxSeats);
  const nameValid = name.trim().length > 0 && name.length <= ROOM_NAME_MAX_LENGTH;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-game-heading"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* Backdrop: dedicated button so it satisfies a11y rules. */}
      <button
        type="button"
        aria-label="close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative w-full max-w-md rounded-xl bg-emerald-900 ring-1 ring-emerald-700 p-6 shadow-2xl">
        <h2 id="create-game-heading" className="text-xl font-bold text-white mb-4">
          Create a game
        </h2>
        {/* No `action` set: fetcher.Form defaults to the route that rendered
            it (_index), which Remix encodes as /?index. An explicit
            action="/" would target the root layout instead and 405. */}
        <fetcher.Form method="post" className="space-y-4">
          <AuthenticityTokenInput />
          <input type="hidden" name="intent" value="create_room" />

          <div>
            <label
              htmlFor="create-name"
              className="block text-xs uppercase tracking-wider text-emerald-200/80 mb-1"
            >
              Name <span className="text-red-300">*</span>
            </label>
            <input
              id="create-name"
              name="name"
              type="text"
              required
              maxLength={ROOM_NAME_MAX_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Friday Night Poker"
              className="w-full rounded bg-emerald-950 text-white border border-emerald-700 px-3 py-2"
            />
            <p className="mt-1 text-xs text-emerald-200/60">
              Visible to anyone you invite. Must be unique among rooms you&apos;ve created.
            </p>
          </div>

          <div>
            <label
              htmlFor="create-game-type"
              className="block text-xs uppercase tracking-wider text-emerald-200/80 mb-1"
            >
              Game
            </label>
            <select
              id="create-game-type"
              name="gameType"
              value={gameType}
              onChange={(e) =>
                setGameType(
                  e.target.value as
                    | 'blackjack'
                    | 'poker'
                    | 'holdem'
                    | 'slots'
                    | 'roulette'
                    | 'baccarat',
                )
              }
              className="w-full rounded bg-emerald-950 text-white border border-emerald-700 px-3 py-2"
            >
              <option value="blackjack">Blackjack</option>
              <option value="poker">5-Card Draw</option>
              <option value="holdem">Texas Hold&apos;em</option>
              <option value="slots">Slots</option>
              <option value="roulette">Roulette</option>
              <option value="baccarat">Baccarat</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="create-num-seats"
              className="block text-xs uppercase tracking-wider text-emerald-200/80 mb-1"
            >
              Players (excluding dealer)
            </label>
            <input
              id="create-num-seats"
              name="numSeats"
              type="number"
              min={minSeats}
              max={maxSeats}
              value={effectiveSeats}
              onChange={(e) => setNumSeats(parseInt(e.target.value, 10) || minSeats)}
              className="w-full rounded bg-emerald-950 text-white border border-emerald-700 px-3 py-2 tabular-nums"
            />
            <p className="mt-1 text-xs text-emerald-200/60">
              {minSeats === maxSeats ? `${minSeats} seat` : `${minSeats}–${maxSeats} seats`}. Empty
              seats are filled by AI bots.
            </p>
          </div>

          <fieldset>
            <legend className="block text-xs uppercase tracking-wider text-emerald-200/80 mb-1">
              Stakes
            </legend>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {(['low', 'high', 'custom'] as const).map((preset) => (
                <label
                  key={preset}
                  className={`cursor-pointer rounded border px-3 py-2 text-center capitalize ${
                    stakes === preset
                      ? 'bg-emerald-700 border-emerald-500 text-white'
                      : 'bg-emerald-950 border-emerald-700 text-emerald-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="stakes"
                    value={preset}
                    checked={stakes === preset}
                    onChange={() => setStakes(preset)}
                    className="sr-only"
                  />
                  {preset === 'low'
                    ? 'Low ($1–$100)'
                    : preset === 'high'
                      ? 'High ($100–$10K)'
                      : 'Custom'}
                </label>
              ))}
            </div>
            {stakes === 'custom' && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="create-custom-min"
                    className="block text-xs uppercase tracking-wider text-emerald-200/80 mb-1"
                  >
                    Min bet
                  </label>
                  <input
                    id="create-custom-min"
                    name="customMin"
                    type="number"
                    min={1}
                    value={customMin}
                    onChange={(e) => setCustomMin(parseInt(e.target.value, 10) || 1)}
                    className="w-full rounded bg-emerald-950 text-white border border-emerald-700 px-3 py-2 tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="create-custom-max"
                    className="block text-xs uppercase tracking-wider text-emerald-200/80 mb-1"
                  >
                    Max bet
                  </label>
                  <input
                    id="create-custom-max"
                    name="customMax"
                    type="number"
                    min={1}
                    value={customMax}
                    onChange={(e) => setCustomMax(parseInt(e.target.value, 10) || 1)}
                    className="w-full rounded bg-emerald-950 text-white border border-emerald-700 px-3 py-2 tabular-nums"
                  />
                </div>
              </div>
            )}
          </fieldset>

          <input
            type="hidden"
            name="minBet"
            value={stakes === 'custom' ? customMin : STAKES_BOUNDS[stakes].min}
          />
          <input
            type="hidden"
            name="maxBet"
            value={stakes === 'custom' ? customMax : STAKES_BOUNDS[stakes].max}
          />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className={buttonClass({ variant: 'neutral' })}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !nameValid}
              className={buttonClass({ variant: 'primary' })}
              title={!nameValid ? 'Enter a room name first' : undefined}
            >
              {submitting ? 'Creating…' : !nameValid ? 'Enter a name' : 'Create'}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
