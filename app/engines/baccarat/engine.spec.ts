import { describe, it, expect } from 'vitest';
import { baccaratEngine } from './engine';
import { BANKER_COMMISSION, bankerDraws, cardValue, handTotal, type BaccaratState } from './types';
import { seededRng } from '../rng';
import type { CardData, Rank, Suit } from 'lib/gameState';

function card(rank: Rank, suit: Suit = 'spades'): CardData {
  return { suit, rank };
}

describe('cardValue', () => {
  it('Ace = 1', () => {
    expect(cardValue(card('Ace'))).toBe(1);
  });
  it('2..9 = face value', () => {
    expect(cardValue(card('2'))).toBe(2);
    expect(cardValue(card('5'))).toBe(5);
    expect(cardValue(card('9'))).toBe(9);
  });
  it('10/J/Q/K = 0', () => {
    expect(cardValue(card('10'))).toBe(0);
    expect(cardValue(card('Jack'))).toBe(0);
    expect(cardValue(card('Queen'))).toBe(0);
    expect(cardValue(card('King'))).toBe(0);
  });
});

describe('handTotal', () => {
  it('returns sum mod 10', () => {
    expect(handTotal([card('7'), card('8')])).toBe(5); // 15 % 10 = 5
    expect(handTotal([card('King'), card('9')])).toBe(9);
    expect(handTotal([card('Jack'), card('10')])).toBe(0);
    expect(handTotal([card('Ace'), card('5'), card('3')])).toBe(9);
  });
});

describe('bankerDraws (the tableau)', () => {
  // Player stood (6 or 7) — banker uses the simple rule.
  it('player stood: banker draws on 0-5, stands on 6-7', () => {
    for (let t = 0; t <= 5; t++) {
      expect(bankerDraws(t, null)).toBe(true);
    }
    expect(bankerDraws(6, null)).toBe(false);
    expect(bankerDraws(7, null)).toBe(false);
  });

  // Player drew a third card — exhaust every cell.
  const cases: Array<[number, number, boolean]> = [];
  for (const bt of [0, 1, 2] as const) {
    for (let pt = 0; pt <= 9; pt++) cases.push([bt, pt, true]);
  }
  for (let pt = 0; pt <= 9; pt++) cases.push([3, pt, pt !== 8]);
  for (let pt = 0; pt <= 9; pt++) cases.push([4, pt, pt >= 2 && pt <= 7]);
  for (let pt = 0; pt <= 9; pt++) cases.push([5, pt, pt >= 4 && pt <= 7]);
  for (let pt = 0; pt <= 9; pt++) cases.push([6, pt, pt === 6 || pt === 7]);
  for (let pt = 0; pt <= 9; pt++) cases.push([7, pt, false]);

  for (const [bt, pt, expected] of cases) {
    it(`banker total ${bt} + player 3rd ${pt} → ${expected ? 'draw' : 'stand'}`, () => {
      expect(bankerDraws(bt, pt)).toBe(expected);
    });
  }
});

// 416 cards in an 8-deck shoe → 415 Fisher-Yates swaps. Pad with zeros
// so seededRng never runs dry.
const SHUFFLE_RNG_PAD = new Array(500).fill(0);

describe('baccaratEngine.initialState', () => {
  it('produces an 8-deck shoe (416 cards) by default', () => {
    const state = baccaratEngine.initialState(
      { minimumBet: 1, maximumBet: 100 },
      ['p1'],
      seededRng(SHUFFLE_RNG_PAD),
    );
    expect(state.deck.length).toBe(8 * 52);
    expect(state.phase).toBe('awaiting_bets');
    expect(state.players.length).toBe(1);
    expect(state.players[0].bets).toEqual([]);
    expect(state.config.tiePayout).toBe(8);
  });

  it('respects custom numDecks + tiePayout', () => {
    const state = baccaratEngine.initialState(
      { minimumBet: 1, maximumBet: 100, numDecks: 6, tiePayout: 9 },
      ['p1'],
      seededRng(SHUFFLE_RNG_PAD),
    );
    expect(state.deck.length).toBe(6 * 52);
    expect(state.config.tiePayout).toBe(9);
  });
});

describe('baccaratEngine place_bet validation', () => {
  function freshState(): BaccaratState {
    return baccaratEngine.initialState(
      { minimumBet: 5, maximumBet: 100 },
      ['p1'],
      seededRng(SHUFFLE_RNG_PAD),
    );
  }

  it('accepts a valid bet and tracks the stake', () => {
    const after = baccaratEngine.applyAction(
      freshState(),
      'p1',
      { kind: 'place_bet', playerId: 'p1', bet: { kind: 'player', amount: 20 } },
      seededRng([]),
    );
    expect(after.players[0].bets.length).toBe(1);
    expect(after.players[0].bets[0].kind).toBe('player');
    expect(after.players[0].totalStake).toBe(20);
  });

  it('rejects below table minimum', () => {
    expect(() =>
      baccaratEngine.applyAction(
        freshState(),
        'p1',
        { kind: 'place_bet', playerId: 'p1', bet: { kind: 'player', amount: 1 } },
        seededRng([]),
      ),
    ).toThrow(/below table minimum/);
  });

  it('rejects above table maximum', () => {
    expect(() =>
      baccaratEngine.applyAction(
        freshState(),
        'p1',
        { kind: 'place_bet', playerId: 'p1', bet: { kind: 'tie', amount: 500 } },
        seededRng([]),
      ),
    ).toThrow(/above table maximum/);
  });
});

describe('baccaratEngine.deal — outcomes & payouts', () => {
  /**
   * Stack the deck so initialState's shuffle produces a known order.
   * The shoe is drawn via `pop()` (top = end of array), so the LAST
   * element we place in the deck is the first card dealt. We use a
   * pre-stacked state directly to avoid simulating the shuffle.
   */
  function stateWithDeck(deckBottomToTop: CardData[]): BaccaratState {
    // Skip initialState's shuffle (which would consume the seeded RNG)
    // by constructing the state shape directly.
    return {
      type: 'baccarat',
      config: { minimumBet: 1, maximumBet: 1000, numDecks: 8, tiePayout: 8 },
      deck: [...deckBottomToTop],
      playerHand: [],
      bankerHand: [],
      players: [{ id: 'p1', bets: [], totalStake: 0, winnings: 0 }],
      phase: 'awaiting_bets',
      toAct: 'p1',
      outcome: null,
      playerTotal: null,
      bankerTotal: null,
    };
  }

  // Helper to push a place_bet through the engine.
  function bet(
    state: BaccaratState,
    kind: 'player' | 'banker' | 'tie',
    amount: number,
  ): BaccaratState {
    return baccaratEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', bet: { kind, amount } },
      seededRng([]),
    );
  }

  function deal(state: BaccaratState): BaccaratState {
    return baccaratEngine.applyAction(state, 'p1', { kind: 'deal', playerId: 'p1' }, seededRng([]));
  }

  it('natural 9 vs 7: player wins; player bet pays 2x, banker bet loses', () => {
    // Engine deals P, B, P, B. pop() returns the LAST array element first,
    // so the array is bottom-to-top: index 3 = P1 (first popped),
    // index 2 = B1, index 1 = P2, index 0 = B2.
    // Want P = 5,4 (=9 natural) and B = K,7 (=7). Both naturals halt.
    const deck: CardData[] = [
      card('7'), // popped 4th → B2
      card('4'), // popped 3rd → P2
      card('King'), // popped 2nd → B1
      card('5'), // popped 1st → P1
    ];
    let s = stateWithDeck(deck);
    s = bet(s, 'player', 10);
    s = bet(s, 'banker', 10);
    s = deal(s);

    expect(s.outcome).toBe('player');
    expect(s.playerTotal).toBe(9);
    expect(s.bankerTotal).toBe(7);
    expect(s.players[0].bets[0].payout).toBe(20); // player bet wins, pays 2x stake
    expect(s.players[0].bets[1].payout).toBe(0); // banker bet loses
    expect(s.players[0].winnings).toBe(20);
  });

  it('tie pays 8:1 plus stake return on the tie bet; player/banker bets push', () => {
    // Want both totals = 9, no draws (both naturals).
    // P = 4,5 (9); B = 4,5 (9). Pop order: P1,B1,P2,B2 → bottom-to-top is reversed:
    //   [B2, P2, B1, P1] = [5♠, 5♠, 4♠, 4♠]
    const deck: CardData[] = [card('5'), card('5'), card('4'), card('4')];
    let s = stateWithDeck(deck);
    s = bet(s, 'player', 10);
    s = bet(s, 'banker', 10);
    s = bet(s, 'tie', 5);
    s = deal(s);

    expect(s.outcome).toBe('tie');
    // Player bet: pushed, payout = stake returned.
    expect(s.players[0].bets[0].pushed).toBe(true);
    expect(s.players[0].bets[0].payout).toBe(10);
    // Banker bet: pushed.
    expect(s.players[0].bets[1].pushed).toBe(true);
    expect(s.players[0].bets[1].payout).toBe(10);
    // Tie bet: 8:1 + stake return = 9x stake.
    expect(s.players[0].bets[2].payout).toBe(5 * 9);
    expect(s.players[0].winnings).toBe(10 + 10 + 45);
  });

  it('banker wins with 5% commission, floor-rounded', () => {
    // Want B > P, no naturals, draws follow tableau.
    // P = 2,3 (5) → draws on 5; B = 2,4 (6) → stands (player drew, banker total
    // 6 only draws on player's 3rd in {6,7}).
    // Pop order: P1=2, B1=2, P2=3, B2=4, then P3 (since P=5 draws).
    // To stop with B2's standing, we control P3 to not be 6 or 7. Make P3=Ace (value 1).
    // Final P = 2+3+1 = 6, B = 2+4 = 6 — that's a TIE, not banker win.
    //
    // Try: P=2,2 (4) → draws; B=4,3 (7) → stands (banker 7 always stands).
    // Pop order: P1=2, B1=4, P2=2, B2=3, P3 something.
    // Total: P = 2+2+P3 mod 10, B = 7. For banker win, P_total < 7.
    // P3 = 4 → P total = 8 (P wins). P3 = 3 → P = 7 (tie). P3 = 2 → P = 6 (banker wins).
    // So P3 = 2.
    // Deck bottom→top: [P3=2, B2=3, P2=2, B1=4, P1=2] reversed for pop order.
    // pop() takes the LAST element first. So we want top of stack = P1 = 2.
    //   Stack (bottom→top): [P3=2, B2=3, P2=2, B1=4, P1=2]
    const deck: CardData[] = [card('2'), card('3'), card('2'), card('4'), card('2')];
    let s = stateWithDeck(deck);
    s = bet(s, 'banker', 100);
    s = deal(s);

    expect(s.outcome).toBe('banker');
    expect(s.playerTotal).toBe(6);
    expect(s.bankerTotal).toBe(7);
    // Commission: 5% of 100 = 5; payout = stake + (stake - 5) = 100 + 95 = 195.
    expect(s.players[0].bets[0].payout).toBe(195);
    // Floor rounding sanity: $25 banker win → 25 + floor(25 * 0.95) = 25 + 23 = 48.
    expect(Math.floor(25 * (1 - BANKER_COMMISSION))).toBe(23);
  });
});

describe('baccaratEngine.aiAction', () => {
  it('produces a valid place_bet within the table bounds', () => {
    const state = baccaratEngine.initialState(
      { minimumBet: 5, maximumBet: 100 },
      ['p1'],
      seededRng(SHUFFLE_RNG_PAD),
    );
    // Drive randomness so we cover all three branches.
    for (const roll of [0, 50, 99]) {
      // amount path: amount within [min, min*3] uses rng for the amount,
      // then rolls for kind. So we need at least 2 values per call.
      const action = baccaratEngine.aiAction!(state, 'p1', seededRng([0, roll]));
      expect(action.kind).toBe('place_bet');
      if (action.kind === 'place_bet') {
        expect(['player', 'banker', 'tie']).toContain(action.bet.kind);
        expect(action.bet.amount).toBeGreaterThanOrEqual(5);
        expect(action.bet.amount).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('baccaratEngine.isTerminal + settle', () => {
  it('settles correctly for a single-player win', () => {
    let s: BaccaratState = {
      type: 'baccarat',
      config: { minimumBet: 1, maximumBet: 1000, numDecks: 8, tiePayout: 8 },
      deck: [card('7'), card('4'), card('King'), card('5')],
      playerHand: [],
      bankerHand: [],
      players: [{ id: 'p1', bets: [], totalStake: 0, winnings: 0 }],
      phase: 'awaiting_bets',
      toAct: 'p1',
      outcome: null,
      playerTotal: null,
      bankerTotal: null,
    };
    s = baccaratEngine.applyAction(
      s,
      'p1',
      { kind: 'place_bet', playerId: 'p1', bet: { kind: 'player', amount: 10 } },
      seededRng([]),
    );
    s = baccaratEngine.applyAction(s, 'p1', { kind: 'deal', playerId: 'p1' }, seededRng([]));

    expect(baccaratEngine.isTerminal(s)).toBe(true);
    const orders = baccaratEngine.settle(s);
    expect(orders).toEqual([{ playerId: 'p1', delta: 10, reason: 'win' }]);
  });
});
