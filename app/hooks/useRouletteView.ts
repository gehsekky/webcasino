import { useEffect, useState } from 'react';
import type { RouletteView } from 'engines/roulette/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Roulette counterpart to the other view hooks. Multi-player matters
 * here: when player A places a bet or the creator spins the wheel,
 * other players at the table should see the table update live without
 * a manual refresh. The room SSE channel already broadcasts the new
 * `RouletteView` after every action; this hook just merges it.
 *
 * Parent remounts on hand transitions via `key={handId}` on the call
 * site, so this hook only handles a single round's lifecycle.
 */
export function useRouletteView(
  roomId: string,
  initialView: RouletteView,
): { view: RouletteView; status: ConnectionStatus } {
  const [view, setView] = useState<RouletteView>(initialView);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/rooms/${roomId}/events`);
    es.onopen = () => setStatus('open');

    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { view: RouletteView };
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
