import { useEffect, useState } from 'react';
import type { BlackjackView } from 'engines/blackjack/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Subscribes to the server-sent `/rooms/:roomId/events` stream and keeps
 * a local copy of the latest `BlackjackView`. Initial value comes from
 * the Remix loader (SSR), so the first paint is correct without waiting
 * for the SSE round-trip; live updates take over once the EventSource
 * opens.
 *
 * Keyed by `roomId`, not `handId`, so a single subscription survives the
 * transition from one hand to the next at the same room — the server
 * picks up whichever hand is active at connection time.
 */
export function useHandView(
  roomId: string,
  initialView: BlackjackView,
): { view: BlackjackView; status: ConnectionStatus } {
  const [view, setView] = useState<BlackjackView>(initialView);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }
    const es = new EventSource(`/rooms/${roomId}/events`);

    es.onopen = () => setStatus('open');

    const handleViewEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { view: BlackjackView };
        if (data?.view) setView(data.view);
      } catch {
        /* ignore malformed payloads */
      }
    };

    es.addEventListener('snapshot', handleViewEvent as EventListener);
    es.addEventListener('state_update', handleViewEvent as EventListener);

    es.onerror = () => {
      // EventSource enters CONNECTING on transient failures; only mark
      // closed once the readyState confirms.
      if (es.readyState === EventSource.CLOSED) {
        setStatus('closed');
      } else {
        setStatus('reconnecting');
      }
    };

    return () => {
      es.close();
      setStatus('closed');
    };
  }, [roomId]);

  return { view, status };
}
