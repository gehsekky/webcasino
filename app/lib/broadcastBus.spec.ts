import { describe, it, expect, beforeEach } from 'vitest';
import { broadcastBus, type BroadcastedHandEvent } from './broadcastBus.server';
import type { BlackjackState } from 'lib/gameState';

const fakeState = {
  type: 'blackjack',
  config: { minimumBet: 5, maximumBet: 100 },
  deck: [],
  dealerHand: [],
  dealerCardsRevealed: false,
  players: [],
  phase: 'awaiting_bets',
  toAct: null,
} as unknown as BlackjackState;

const sampleEvent: BroadcastedHandEvent = {
  action: 'hit',
  actor_id: 'seat-1',
  payload: { kind: 'hit', playerId: 'seat-1' },
  sequence: 7,
  state_after: fakeState,
};

describe('broadcastBus', () => {
  beforeEach(() => {
    broadcastBus.reset();
  });

  it('delivers a published event to a subscriber', () => {
    const received: BroadcastedHandEvent[] = [];
    broadcastBus.subscribe('hand-A', (e) => received.push(e));
    broadcastBus.publish('hand-A', sampleEvent);
    expect(received).toEqual([sampleEvent]);
  });

  it('isolates handIds — events on hand-A do not leak to hand-B subscribers', () => {
    const a: BroadcastedHandEvent[] = [];
    const b: BroadcastedHandEvent[] = [];
    broadcastBus.subscribe('hand-A', (e) => a.push(e));
    broadcastBus.subscribe('hand-B', (e) => b.push(e));
    broadcastBus.publish('hand-A', sampleEvent);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it('delivers to every subscriber on the same hand', () => {
    const a: BroadcastedHandEvent[] = [];
    const b: BroadcastedHandEvent[] = [];
    broadcastBus.subscribe('hand-A', (e) => a.push(e));
    broadcastBus.subscribe('hand-A', (e) => b.push(e));
    broadcastBus.publish('hand-A', sampleEvent);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('unsubscribes correctly', () => {
    const received: BroadcastedHandEvent[] = [];
    const unsubscribe = broadcastBus.subscribe('hand-A', (e) => received.push(e));
    broadcastBus.publish('hand-A', sampleEvent);
    unsubscribe();
    broadcastBus.publish('hand-A', sampleEvent);
    expect(received).toHaveLength(1);
  });

  it('drops the inner Set when the last subscriber unsubscribes', () => {
    const unsubscribe = broadcastBus.subscribe('hand-A', () => {});
    expect(broadcastBus.subscriberCount('hand-A')).toBe(1);
    unsubscribe();
    expect(broadcastBus.subscriberCount('hand-A')).toBe(0);
  });

  it('publish with no subscribers is a no-op', () => {
    expect(() => broadcastBus.publish('lonely-hand', sampleEvent)).not.toThrow();
  });

  it('a throwing subscriber does not break delivery to other subscribers', () => {
    const received: BroadcastedHandEvent[] = [];
    broadcastBus.subscribe('hand-A', () => {
      throw new Error('boom');
    });
    broadcastBus.subscribe('hand-A', (e) => received.push(e));
    broadcastBus.publish('hand-A', sampleEvent);
    expect(received).toEqual([sampleEvent]);
  });
});
