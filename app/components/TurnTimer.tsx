import { useCountdown } from 'hooks/useCountdown';

type TurnTimerProps = {
  /** ISO timestamp when the player auto-folds. Null hides the timer. */
  deadlineAt: string | null;
  /** True when this seat is the one on the clock. */
  active: boolean;
};

/**
 * Countdown badge shown on the seat currently to act. Flashes red
 * (and bumps to a bigger pill) when under 5 seconds remain. Renders
 * nothing when there's no deadline or the seat isn't active — so
 * dropping it into any seat row is safe.
 */
export default function TurnTimer({ deadlineAt, active }: TurnTimerProps) {
  const seconds = useCountdown(active ? deadlineAt : null);
  if (!active || seconds === null) return null;
  const urgent = seconds <= 5;
  return (
    <span
      role="timer"
      aria-live="polite"
      aria-label={`${seconds} seconds until auto-fold`}
      className={`inline-flex items-center justify-center rounded-full font-bold tabular-nums select-none ${
        urgent
          ? 'bg-red-600 text-white animate-pulse px-2.5 py-0.5 text-sm'
          : 'bg-yellow-400 text-slate-900 px-2 py-0.5 text-xs'
      }`}
    >
      {seconds}s
    </span>
  );
}
