import { useFetcher } from '@remix-run/react';
import type { BlackjackAction } from 'engines/blackjack/types';

type ActionBarProps = {
  /** Engine-supplied list of legal actions for this viewer. */
  legalActions: BlackjackAction[];
};

const ACTION_LABEL: Partial<Record<BlackjackAction['kind'], string>> = {
  hit: 'Hit',
  stay: 'Stay',
  double_down: 'Double Down',
  surrender: 'Surrender',
};

/** Engine action kind → the form's existing `submit` value contract. */
const ACTION_SUBMIT_VALUE: Partial<Record<BlackjackAction['kind'], string>> = {
  hit: 'hit',
  stay: 'stay',
  double_down: 'double down',
  surrender: 'surrender',
};

const ACTION_STYLE: Partial<Record<BlackjackAction['kind'], string>> = {
  hit: 'btn-success',
  stay: 'btn-info',
  double_down: 'btn-warning',
  surrender: 'btn-error',
};

export default function ActionBar({ legalActions }: ActionBarProps) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';

  const playable = legalActions.filter((a) => ACTION_LABEL[a.kind]);

  if (playable.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {playable.map((action) => {
        const label = ACTION_LABEL[action.kind]!;
        const submitValue = ACTION_SUBMIT_VALUE[action.kind]!;
        const style = ACTION_STYLE[action.kind] ?? 'btn-primary';
        return (
          <fetcher.Form method="post" key={action.kind}>
            <input type="hidden" name="submit" value={submitValue} />
            <button
              type="submit"
              disabled={submitting}
              className={`btn ${style} font-bold uppercase tracking-wide`}
            >
              {label}
            </button>
          </fetcher.Form>
        );
      })}
    </div>
  );
}
