import { useEffect, useState } from 'react';
import type { SlotsView } from 'engines/slots/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Slots counterpart to `useHandView` / `usePokerView` / `useHoldemView`.
 *
 * Slots is single-seat, so live updates are mostly redundant — the
 * spinning user is the only person affecting state, and a redirect
 * already revalidates the loader after submit. The hook exists for
 * shape consistency with the other game views and to keep the door
 * open for multi-spectator viewing later.
 *
 * Parent remounts on hand transitions via `key={handId}` on the call
 * site, so this hook only handles a single spin's lifecycle.
 */
export function useSlotsView(
  roomId: string,
  initialView: SlotsView,
): { view: SlotsView; status: ConnectionStatus } {
  const [view, setView] = useState<SlotsView>(initialView);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/rooms/${roomId}/events`);
    es.onopen = () => setStatus('open');

    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { view: SlotsView };
        if (data?.view) setView(data.view);
      } catch {
        /* malformed payload — skip */
      }
    };
    es.addEventListener('snapshot', handle as EventListener);
    es.addEventListener('state_update', handle as EventListener);

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setStatus('closed');
      else setStatus('reconnecting');
    };

    return () => {
      es.close();
      setStatus('closed');
    };
  }, [roomId]);

  return { view, status };
}
