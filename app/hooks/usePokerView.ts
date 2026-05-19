import { useEffect, useState } from 'react';
import type { FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Poker counterpart to `useHandView`. Subscribes to the server-sent
 * channel for `handId`, seeds the local state from the loader-provided
 * snapshot, and applies incremental view updates as they arrive.
 *
 * Identical shape to the blackjack hook; the only difference is the
 * `BlackjackView` → `FiveCardDrawView` type swap. Could collapse into a
 * single generic later if we want.
 */
export function usePokerView(
  handId: string,
  initialView: FiveCardDrawView,
): { view: FiveCardDrawView; status: ConnectionStatus } {
  const [view, setView] = useState<FiveCardDrawView>(initialView);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }
    const es = new EventSource(`/hands/${handId}/events`);
    es.onopen = () => setStatus('open');

    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { view: FiveCardDrawView };
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
  }, [handId]);

  return { view, status };
}
