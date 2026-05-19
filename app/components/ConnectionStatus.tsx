import type { ConnectionStatus as Status } from 'hooks/useHandView';

const DOT_CLASS: Record<Status, string> = {
  connecting: 'bg-yellow-400 animate-pulse',
  open: 'bg-emerald-400',
  reconnecting: 'bg-orange-400 animate-pulse',
  closed: 'bg-red-500',
};

const LABEL: Record<Status, string> = {
  connecting: 'connecting',
  open: 'live',
  reconnecting: 'reconnecting',
  closed: 'offline',
};

export default function ConnectionStatus({ status }: { status: Status }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-emerald-200/70"
      aria-live="polite"
    >
      <span className={`inline-block w-2 h-2 rounded-full ${DOT_CLASS[status]}`} aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}
