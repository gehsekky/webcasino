import { describe, it, expect } from 'vitest';
import { foldHandEvents, HAND_INITIALIZED, type StoredHandEvent } from './handEvents';
import { blackjackEngine } from 'engines/blackjack/engine';
import { seededRng } from 'engines/rng';
import type { BlackjackState } from 'lib/gameState';

const playerId = 'seat-1';

function bootstrap(initialState: BlackjackState): StoredHandEvent {
  return { action: HAND_INITIALIZED, actor_id: null, payload: { initialState } };
}

/**
 * A deterministic initial state. The Fisher-Yates shuffle in `initialState`
 * calls `randInt(52), randInt(51), ..., randInt(2)`, so the seed must be a
 * stream of 51 in-range values. Using 0 each time produces a fixed permutation.
 */
function makeInitialState(): BlackjackState {
  const seed = Array.from({ length: 51 }, () => 0);
  return blackjackEngine.initialState(
    { minimumBet: 5, maximumBet: 100, numDecks: 1, dealerHitsSoft17: false },
    [playerId],
    seededRng(seed),
  );
}

describe('foldHandEvents', () => {
  it('throws on empty stream', () => {
    expect(() => foldHandEvents([])).toThrow(/empty/);
  });

  it("throws if the first event is not 'hand_initialized'", () => {
    const events: StoredHandEvent[] = [
      { action: 'hit', actor_id: playerId, payload: { kind: 'hit', playerId } },
    ];
    expect(() => foldHandEvents(events)).toThrow(/hand_initialized/);
  });

  it('returns the initial state when only the bootstrap event exists', () => {
    const initial = makeInitialState();
    expect(foldHandEvents([bootstrap(initial)])).toEqual(initial);
  });

  it('replays place_bet and matches direct engine.applyAction', () => {
    const initial = makeInitialState();
    const betAction = { kind: 'place_bet' as const, playerId, amount: 10 };
    const direct = blackjackEngine.applyAction(initial, playerId, betAction, seededRng([]));

    const replayed = foldHandEvents([
      bootstrap(initial),
      { action: betAction.kind, actor_id: playerId, payload: betAction },
    ]);

    expect(replayed).toEqual(direct);
  });

  it('replays a full single-player hand: bet → stay → dealer_play, ending in settled', () => {
    const initial = makeInitialState();
    const events: StoredHandEvent[] = [bootstrap(initial)];

    // place_bet (auto-deals since single player). After this, phase=playing or settled.
    const bet = { kind: 'place_bet' as const, playerId, amount: 10 };
    events.push({ action: bet.kind, actor_id: playerId, payload: bet });

    let current = foldHandEvents(events);

    // Drive the hand to terminal, mirroring the engine wrapper's behavior:
    //  - if it's the player's turn, stand;
    //  - if the engine has transitioned to 'dealer', append a dealer_play event.
    while (current.phase !== 'settled') {
      if (current.phase === 'playing' && current.toAct === playerId) {
        const stay = { kind: 'stay' as const, playerId };
        events.push({ action: stay.kind, actor_id: playerId, payload: stay });
      } else if (current.phase === 'dealer') {
        const dealerPlay = { kind: 'dealer_play' as const };
        events.push({ action: dealerPlay.kind, actor_id: null, payload: dealerPlay });
      } else {
        throw new Error(`unexpected phase in driver loop: ${current.phase}`);
      }
      current = foldHandEvents(events);
    }

    expect(current.phase).toBe('settled');
    expect(['won', 'lost', 'pushed', 'blackjack', 'busted', 'surrendered']).toContain(
      current.players[0].status,
    );
  });

  it('rejects a malformed initial state payload', () => {
    const bad: StoredHandEvent = {
      action: HAND_INITIALIZED,
      actor_id: null,
      payload: { initialState: { type: 'not blackjack' } },
    };
    expect(() => foldHandEvents([bad])).toThrow();
  });
});
