import { useEffect, useState } from 'react';
import type { BaccaratView } from 'engines/baccarat/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Multi-player SSE hook for baccarat — same shape as `useRouletteView`.
 * Other players placing bets or the creator dealing should both push
 * a fresh view to every viewer at the table.
 */
export function useBaccaratView(
  roomId: string,
  initialView: BaccaratView,
): { view: BaccaratView; status: ConnectionStatus } {
  const [view, setView] = useState<BaccaratView>(initialView);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/rooms/${roomId}/events`);
    es.onopen = () => setStatus('open');

    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { view: BaccaratView };
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
