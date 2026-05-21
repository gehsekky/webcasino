import { Form } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';

/**
 * Shared banner shown inside a hand view when the viewer's persistent
 * seat is currently flagged `sitting_out` — typically because they
 * were auto-folded in this or an earlier hand and haven't rejoined.
 *
 * `role="status"` + `aria-live="polite"` so screen readers hear the
 * banner when it appears (e.g., right after the auto-fold lands).
 *
 * Form submits `intent=rejoin_next_hand` against the current room.
 * The handler clears `seat.sitting_out` for the viewer.
 */
export default function SittingOutBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl bg-amber-900/40 ring-1 ring-amber-600/50 text-amber-100 px-5 py-4 text-center"
    >
      <p className="text-sm font-semibold uppercase tracking-wide">You&apos;re sitting out</p>
      <p className="mt-1 text-xs opacity-80">
        You were auto-folded for missing your turn. You&apos;ll be skipped from the next hand until
        you rejoin.
      </p>
      <Form method="post" className="mt-3">
        <AuthenticityTokenInput />
        <input type="hidden" name="intent" value="rejoin_next_hand" />
        <button
          type="submit"
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400"
        >
          Rejoin next hand
        </button>
      </Form>
    </div>
  );
}
