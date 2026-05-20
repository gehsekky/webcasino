import { useEffect, useState } from 'react';
import type { HoldemView } from 'engines/poker/holdem/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Hold'em counterpart to `useHandView` / `usePokerView`. Subscribes to
 * the room SSE channel, seeds local state from the SSR snapshot, and
 * applies incremental view updates as they arrive.
 *
 * Parent remounts on hand transitions via `key={handId}` on the call
 * site, so this hook only has to handle a single hand's lifecycle.
 */
export function useHoldemView(
  roomId: string,
  initialView: HoldemView,
): { view: HoldemView; status: ConnectionStatus } {
  const [view, setView] = useState<HoldemView>(initialView);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/rooms/${roomId}/events`);
    es.onopen = () => setStatus('open');

    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { view: HoldemView };
        if (data?.view) setView(data.view);
      } catch {
        /* malformed payload; skip */
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
