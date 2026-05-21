import { useEffect, useState } from 'react';

/**
 * Renders a live countdown until `deadlineAt`. Returns the number of
 * seconds remaining (rounded down, never negative), or `null` if no
 * deadline is set.
 *
 * Ticks once per second using setInterval, cleaned up on unmount.
 * SSR-safe: the initial render returns `null` (so server and client
 * agree on the first paint), then the effect populates the live value
 * after hydration.
 */
export function useCountdown(deadlineAt: string | null): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!deadlineAt) {
      setSecondsLeft(null);
      return;
    }
    const target = new Date(deadlineAt).getTime();
    const compute = () => {
      const ms = target - Date.now();
      return Math.max(0, Math.floor(ms / 1000));
    };
    setSecondsLeft(compute());
    const id = setInterval(() => {
      setSecondsLeft(compute());
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineAt]);

  return secondsLeft;
}
