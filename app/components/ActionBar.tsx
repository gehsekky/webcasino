import { useFetcher } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import type { BlackjackAction } from 'engines/blackjack/types';
import { buttonClass, type ButtonVariant } from 'lib/buttonStyle';

type ActionBarProps = {
  /** Engine-supplied list of legal actions for this viewer. */
  legalActions: BlackjackAction[];
};

const ACTION_LABEL: Partial<Record<BlackjackAction['kind'], string>> = {
  hit: 'Hit',
  stay: 'Stay',
  double_down: 'Double Down',
  split: 'Split',
  surrender: 'Surrender',
};

/** Engine action kind → the form's existing `submit` value contract. */
const ACTION_SUBMIT_VALUE: Partial<Record<BlackjackAction['kind'], string>> = {
  hit: 'hit',
  stay: 'stay',
  double_down: 'double down',
  split: 'split',
  surrender: 'surrender',
};

const ACTION_VARIANT: Partial<Record<BlackjackAction['kind'], ButtonVariant>> = {
  hit: 'success',
  stay: 'info',
  double_down: 'warning',
  split: 'primary',
  surrender: 'danger',
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
        const variant = ACTION_VARIANT[action.kind] ?? 'primary';
        return (
          <fetcher.Form method="post" key={action.kind}>
            <AuthenticityTokenInput />
            <input type="hidden" name="submit" value={submitValue} />
            <button type="submit" disabled={submitting} className={buttonClass({ variant })}>
              {label}
            </button>
          </fetcher.Form>
        );
      })}
    </div>
  );
}
