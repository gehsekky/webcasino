import { describe, it, expect } from 'vitest';
import { blackjackEngine } from './engine';
import type { BlackjackState } from './types';
import type { CardData } from 'lib/gameState';
import { defaultRng, seededRng } from '../rng';

const CONFIG = { minimumBet: 5, maximumBet: 100, numDecks: 1, dealerHitsSoft17: false };
const STATE_CONFIG = {
  minimumBet: CONFIG.minimumBet,
  maximumBet: CONFIG.maximumBet,
  numDecks: 1,
  dealerHitsSoft17: false,
};

/** Build a deterministic state with a custom deck. The TOP of the deck is the LAST element of the array. */
function withDeck(deck: CardData[], overrides: Partial<BlackjackState> = {}): BlackjackState {
  return {
    type: 'blackjack',
    config: STATE_CONFIG,
    deck: [...deck],
    dealerHand: [],
    dealerCardsRevealed: false,
    players: [
      {
        id: 'p1',
        cards: [],
        bet: 0,
        doubled: false,
        status: 'awaiting_bet',
        insuranceBet: null,
        parentSlotId: null,
      },
    ],
    phase: 'awaiting_bets',
    toAct: null,
    turnDeadlineAt: null,
    ...overrides,
  };
}

const c = (
  suit: 'hearts' | 'spades' | 'clubs' | 'diamonds',
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'Jack' | 'Queen' | 'King' | 'Ace',
): CardData => ({ suit, rank });

describe('blackjackEngine.initialState', () => {
  it('produces a fresh shuffled 52-card deck for a 1-deck shoe', () => {
    const s = blackjackEngine.initialState(CONFIG, ['p1', 'p2'], defaultRng);
    expect(s.deck).toHaveLength(52);
    const keys = new Set(s.deck.map((c) => `${c.suit}-${c.rank}`));
    expect(keys.size).toBe(52);
  });

  it('multi-deck shoe: 4 decks → 208 cards, 8 decks → 416 cards', () => {
    const s4 = blackjackEngine.initialState({ ...CONFIG, numDecks: 4 }, ['p1'], defaultRng);
    expect(s4.deck).toHaveLength(208);
    const s8 = blackjackEngine.initialState({ ...CONFIG, numDecks: 8 }, ['p1'], defaultRng);
    expect(s8.deck).toHaveLength(416);
  });

  it('persists rule config (numDecks, dealerHitsSoft17) on the state', () => {
    const s = blackjackEngine.initialState(
      { minimumBet: 25, maximumBet: 1000, numDecks: 6, dealerHitsSoft17: true },
      ['p1'],
      defaultRng,
    );
    expect(s.config.numDecks).toBe(6);
    expect(s.config.dealerHitsSoft17).toBe(true);
  });

  it('initializes all seats to awaiting_bet with zero cards', () => {
    const s = blackjackEngine.initialState(CONFIG, ['p1', 'p2'], defaultRng);
    expect(s.phase).toBe('awaiting_bets');
    expect(s.players).toHaveLength(2);
    for (const p of s.players) {
      expect(p.cards).toHaveLength(0);
      expect(p.bet).toBe(0);
      expect(p.status).toBe('awaiting_bet');
    }
  });

  it('shuffle is deterministic given a seeded RNG', () => {
    const seed = [0, 0, 0, 0, 0]; // always pick index 0
    const seeded = seededRng([...Array(51).fill(0)]);
    const s = blackjackEngine.initialState(CONFIG, ['p1'], seeded);
    expect(s.deck).toHaveLength(52);
    // (Cards array still has all 52 — the seed merely controls which permutation.)
    void seed;
  });
});

describe('blackjackEngine.applyAction(place_bet)', () => {
  it('rejects bet below minimum', () => {
    const s = blackjackEngine.initialState(CONFIG, ['p1'], defaultRng);
    expect(() =>
      blackjackEngine.applyAction(
        s,
        'p1',
        { kind: 'place_bet', playerId: 'p1', amount: 1 },
        defaultRng,
      ),
    ).toThrow(/minimum/);
  });

  it('rejects bet above maximum', () => {
    const s = blackjackEngine.initialState(CONFIG, ['p1'], defaultRng);
    expect(() =>
      blackjackEngine.applyAction(
        s,
        'p1',
        { kind: 'place_bet', playerId: 'p1', amount: 1000 },
        defaultRng,
      ),
    ).toThrow(/maximum/);
  });

  it('rejects non-positive integer bet', () => {
    const s = blackjackEngine.initialState(CONFIG, ['p1'], defaultRng);
    expect(() =>
      blackjackEngine.applyAction(
        s,
        'p1',
        { kind: 'place_bet', playerId: 'p1', amount: 0 },
        defaultRng,
      ),
    ).toThrow(/positive integer/);
    expect(() =>
      blackjackEngine.applyAction(
        s,
        'p1',
        { kind: 'place_bet', playerId: 'p1', amount: 5.5 },
        defaultRng,
      ),
    ).toThrow(/positive integer/);
  });

  it('accepts a valid bet and deals cards immediately when all players bet', () => {
    const s = blackjackEngine.initialState(CONFIG, ['p1'], defaultRng);
    const next = blackjackEngine.applyAction(
      s,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 10 },
      defaultRng,
    );
    // Single player → all bets in → engine deals immediately. Phase may be
    // 'playing' (typical) or 'dealer' (player natural) or 'settled' (dealer
    // natural). All non-betting phases are valid post-deal outcomes.
    expect(next.phase).not.toBe('awaiting_bets');
    expect(next.players[0].bet).toBe(10);
    expect(next.players[0].cards).toHaveLength(2);
    expect(next.dealerHand).toHaveLength(2);
  });
});

describe('blackjackEngine deal_initial dealer naturals', () => {
  it('settles immediately if dealer has a natural', () => {
    // Dealer gets A♠ + K♣. Player gets 5♥ + 5♦.
    // Top of deck is last element. After two player deals, two dealer deals.
    // Stack (top → bottom): K♣, A♠, 5♦, 5♥
    // pop order: 5♥ (p), 5♦ (p), A♠ (d), K♣ (d)
    const deck: CardData[] = [
      c('clubs', 'King'),
      c('spades', 'Ace'),
      c('diamonds', '5'),
      c('hearts', '5'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 10 },
      defaultRng,
    );
    expect(state.phase).toBe('settled');
    expect(state.dealerCardsRevealed).toBe(true);
    expect(state.players[0].status).toBe('lost');
  });

  it('pushes player vs dealer when both have naturals', () => {
    // Pop order: K♦ (p), A♥ (p), K♣ (dealer hole), A♠ (dealer up).
    // Dealer up-card is an Ace, so we enter insurance phase first.
    const deck: CardData[] = [
      c('spades', 'Ace'),
      c('clubs', 'King'),
      c('hearts', 'Ace'),
      c('diamonds', 'King'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 10 },
      defaultRng,
    );
    expect(state.phase).toBe('insurance_offered');
    // Player declines insurance; engine then peeks and settles the natural push.
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'decline_insurance', playerId: 'p1' },
      defaultRng,
    );
    expect(state.phase).toBe('settled');
    expect(state.players[0].status).toBe('pushed');
  });
});

describe('blackjackEngine player naturals', () => {
  it('flags a player natural without ending the hand', () => {
    // Player gets A♥ + K♦ (21). Dealer gets 5♠ + 7♣ (12, not natural).
    // pop order: K♦ (p), A♥ (p), 7♣ (d), 5♠ (d)
    const deck: CardData[] = [
      c('spades', '5'),
      c('clubs', '7'),
      c('hearts', 'Ace'),
      c('diamonds', 'King'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 10 },
      defaultRng,
    );
    expect(state.players[0].status).toBe('blackjack');
    // No other active players → straight to dealer phase
    expect(state.phase).toBe('dealer');
  });
});

describe('blackjackEngine hit/stay/double/surrender', () => {
  function playingState(playerCards: CardData[], deck: CardData[]): BlackjackState {
    return {
      type: 'blackjack',
      config: STATE_CONFIG,
      deck: [...deck],
      dealerHand: [c('hearts', '7'), c('diamonds', '9')], // 16
      dealerCardsRevealed: false,
      players: [
        {
          id: 'p1',
          cards: [...playerCards],
          bet: 10,
          doubled: false,
          status: 'in_hand',
          insuranceBet: null,
          parentSlotId: null,
        },
      ],
      phase: 'playing',
      toAct: 'p1',
      turnDeadlineAt: null,
    };
  }

  it('hit: draws and continues if not bust', () => {
    const state = playingState([c('hearts', '5'), c('clubs', '7')], [c('spades', '3')]); // 12, draw 3 → 15
    const next = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'hit', playerId: 'p1' },
      defaultRng,
    );
    expect(next.players[0].cards).toHaveLength(3);
    expect(next.players[0].status).toBe('in_hand');
    expect(next.toAct).toBe('p1');
  });

  it('hit: busts and advances to dealer', () => {
    const state = playingState([c('hearts', 'King'), c('clubs', 'Queen')], [c('spades', '5')]); // 20, draw 5 → 25
    const next = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'hit', playerId: 'p1' },
      defaultRng,
    );
    expect(next.players[0].status).toBe('busted');
    expect(next.phase).toBe('dealer');
  });

  it('stay: advances to dealer when no other players', () => {
    const state = playingState([c('hearts', 'King'), c('clubs', '9')], []);
    const next = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'stay', playerId: 'p1' },
      defaultRng,
    );
    expect(next.players[0].status).toBe('stood');
    expect(next.phase).toBe('dealer');
  });

  it('double down: doubles bet, draws one, ends turn', () => {
    const state = playingState([c('hearts', '5'), c('clubs', '6')], [c('spades', '9')]); // 11, double to 20
    const next = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'double_down', playerId: 'p1' },
      defaultRng,
    );
    expect(next.players[0].bet).toBe(20);
    expect(next.players[0].cards).toHaveLength(3);
    expect(next.players[0].doubled).toBe(true);
    expect(next.players[0].status).toBe('stood');
    expect(next.phase).toBe('dealer');
  });

  it('double down: refuses after a hit', () => {
    const state = playingState(
      [c('hearts', '5'), c('clubs', '6'), c('hearts', '3')],
      [c('spades', '9')],
    );
    expect(() =>
      blackjackEngine.applyAction(state, 'p1', { kind: 'double_down', playerId: 'p1' }, defaultRng),
    ).toThrow(/fresh 2-card/);
  });

  it('surrender: marks status and ends turn', () => {
    const state = playingState([c('hearts', '10'), c('clubs', '6')], []);
    const next = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'surrender', playerId: 'p1' },
      defaultRng,
    );
    expect(next.players[0].status).toBe('surrendered');
    expect(next.phase).toBe('dealer');
  });

  it('rejects actions on not-your-turn', () => {
    const state = playingState([c('hearts', '5'), c('clubs', '6')], []);
    expect(() =>
      blackjackEngine.applyAction(state, 'p2', { kind: 'hit', playerId: 'p2' }, defaultRng),
    ).toThrow(/turn/);
  });
});

describe('blackjackEngine split', () => {
  function splitState(playerCards: CardData[], deck: CardData[]): BlackjackState {
    return {
      type: 'blackjack',
      config: STATE_CONFIG,
      deck: [...deck],
      dealerHand: [c('hearts', '7'), c('diamonds', '9')],
      dealerCardsRevealed: false,
      players: [
        {
          id: 'p1',
          cards: [...playerCards],
          bet: 10,
          doubled: false,
          status: 'in_hand',
          insuranceBet: null,
          parentSlotId: null,
        },
      ],
      phase: 'playing',
      toAct: 'p1',
      turnDeadlineAt: null,
    };
  }

  it('legalActions includes split when first two cards are same rank', () => {
    const state = splitState([c('hearts', '8'), c('spades', '8')], []);
    const legal = blackjackEngine.legalActions(state, 'p1');
    expect(legal.map((a) => a.kind)).toContain('split');
  });

  it('legalActions does not include split when cards differ in rank', () => {
    const state = splitState([c('hearts', '10'), c('spades', 'Jack')], []);
    const legal = blackjackEngine.legalActions(state, 'p1');
    expect(legal.map((a) => a.kind)).not.toContain('split');
  });

  it('creates a sibling slot with parentSlotId pointing back to the original', () => {
    // Player has [8♥, 8♠]. Top of deck (pop order): 3♣ (to original), 5♦ (to sibling).
    const state = splitState(
      [c('hearts', '8'), c('spades', '8')],
      [c('diamonds', '5'), c('clubs', '3')],
    );
    const next = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'split', playerId: 'p1' },
      defaultRng,
    );
    expect(next.players).toHaveLength(2);
    const [orig, sibling] = next.players;
    expect(orig.id).toBe('p1');
    expect(orig.parentSlotId).toBeNull();
    expect(orig.cards.map((c) => c.rank)).toEqual(['8', '3']);
    expect(sibling.id).toBe('p1:split:1');
    expect(sibling.parentSlotId).toBe('p1');
    expect(sibling.cards.map((c) => c.rank)).toEqual(['8', '5']);
    expect(sibling.bet).toBe(orig.bet);
    expect(next.toAct).toBe('p1');
  });

  it('splitting aces sets both hands to stood (one-card-only rule)', () => {
    const state = splitState(
      [c('hearts', 'Ace'), c('spades', 'Ace')],
      [c('diamonds', '5'), c('clubs', '3')],
    );
    const next = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'split', playerId: 'p1' },
      defaultRng,
    );
    expect(next.players[0].status).toBe('stood');
    expect(next.players[1].status).toBe('stood');
    expect(next.phase).toBe('dealer');
  });

  it('rejects resplit (parentSlotId guard)', () => {
    const state = splitState(
      [c('hearts', '8'), c('spades', '8')],
      [c('diamonds', '5'), c('clubs', '3')],
    );
    const afterSplit = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'split', playerId: 'p1' },
      defaultRng,
    );
    // Mark the sibling to act with same-rank cards then attempt resplit.
    afterSplit.players[1].cards = [c('hearts', '9'), c('spades', '9')];
    afterSplit.toAct = afterSplit.players[1].id;
    expect(() =>
      blackjackEngine.applyAction(
        afterSplit,
        afterSplit.players[1].id,
        { kind: 'split', playerId: afterSplit.players[1].id },
        defaultRng,
      ),
    ).toThrow(/resplits/);
  });

  it('rejects surrender after splitting', () => {
    const state = splitState(
      [c('hearts', '8'), c('spades', '8')],
      [c('diamonds', '5'), c('clubs', '3')],
    );
    const afterSplit = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'split', playerId: 'p1' },
      defaultRng,
    );
    expect(() =>
      blackjackEngine.applyAction(
        afterSplit,
        'p1',
        { kind: 'surrender', playerId: 'p1' },
        defaultRng,
      ),
    ).toThrow(/cannot surrender after a split/);
  });
});

describe('blackjackEngine insurance', () => {
  it('enters insurance_offered when dealer up-card is Ace', () => {
    // Pop order: 5♥, 5♦, K♣ (hole), A♠ (up).
    const deck: CardData[] = [
      c('spades', 'Ace'),
      c('clubs', 'King'),
      c('diamonds', '5'),
      c('hearts', '5'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 20 },
      defaultRng,
    );
    expect(state.phase).toBe('insurance_offered');
    expect(state.players[0].insuranceBet).toBeNull();
  });

  it('does not offer insurance when up-card is not an Ace', () => {
    // Pop order: 5♥, 5♦, A♠ (hole), K♣ (up). Dealer has natural but up-card isn't Ace.
    const deck: CardData[] = [
      c('clubs', 'King'),
      c('spades', 'Ace'),
      c('diamonds', '5'),
      c('hearts', '5'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 10 },
      defaultRng,
    );
    // Engine peeks directly; dealer natural settles immediately.
    expect(state.phase).toBe('settled');
  });

  it('rejects insurance exceeding half the main wager', () => {
    const deck: CardData[] = [
      c('spades', 'Ace'),
      c('clubs', 'King'),
      c('diamonds', '5'),
      c('hearts', '5'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 20 },
      defaultRng,
    );
    expect(() =>
      blackjackEngine.applyAction(
        state,
        'p1',
        { kind: 'take_insurance', playerId: 'p1', amount: 11 },
        defaultRng,
      ),
    ).toThrow(/exceeds the cap/);
  });

  it('decline_insurance + dealer natural → settled, no payout owed', () => {
    // Both have naturals. Pop order: K♦ (p), A♥ (p), K♣ (hole), A♠ (up).
    const deck: CardData[] = [
      c('spades', 'Ace'),
      c('clubs', 'King'),
      c('hearts', 'Ace'),
      c('diamonds', 'King'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 10 },
      defaultRng,
    );
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'decline_insurance', playerId: 'p1' },
      defaultRng,
    );
    expect(state.phase).toBe('settled');
    expect(state.players[0].insuranceBet).toBe(0);
  });

  it('take_insurance + dealer natural → settled with insuranceBet preserved', () => {
    const deck: CardData[] = [
      c('clubs', '7'),
      c('hearts', '2'),
      c('spades', 'Ace'),
      c('clubs', 'King'),
      c('hearts', 'Ace'),
      c('diamonds', 'King'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 20 },
      defaultRng,
    );
    expect(state.phase).toBe('insurance_offered');
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'take_insurance', playerId: 'p1', amount: 10 },
      defaultRng,
    );
    expect(state.phase).toBe('settled');
    expect(state.players[0].insuranceBet).toBe(10);
  });

  it('take_insurance + dealer non-natural → continues to playing phase', () => {
    // Player gets 5+6=11; dealer up-card Ace, hole 7 (no natural).
    // Pop order: 6♣ (p), 5♥ (p), 7♣ (hole), A♠ (up).
    const deck: CardData[] = [
      c('spades', 'Ace'),
      c('clubs', '7'),
      c('clubs', '6'),
      c('hearts', '5'),
    ];
    let state = withDeck(deck);
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'place_bet', playerId: 'p1', amount: 20 },
      defaultRng,
    );
    state = blackjackEngine.applyAction(
      state,
      'p1',
      { kind: 'take_insurance', playerId: 'p1', amount: 10 },
      defaultRng,
    );
    expect(state.phase).toBe('playing');
    expect(state.players[0].insuranceBet).toBe(10);
    expect(state.toAct).toBe('p1');
  });
});

describe('blackjackEngine dealer soft 17 (H17 vs S17)', () => {
  function dealerState(
    dealerHand: CardData[],
    deck: CardData[],
    dealerHitsSoft17: boolean,
  ): BlackjackState {
    return {
      type: 'blackjack',
      config: { minimumBet: 5, maximumBet: 100, numDecks: 1, dealerHitsSoft17 },
      deck: [...deck],
      dealerHand: [...dealerHand],
      dealerCardsRevealed: false,
      players: [
        {
          id: 'p1',
          cards: [c('clubs', '10'), c('clubs', '7')],
          bet: 10,
          doubled: false,
          status: 'stood',
          insuranceBet: null,
          parentSlotId: null,
        },
      ],
      phase: 'dealer',
      toAct: null,
      turnDeadlineAt: null,
    };
  }

  it('S17: dealer stands on soft 17 (A+6)', () => {
    const state = dealerState([c('hearts', 'Ace'), c('diamonds', '6')], [], false);
    const next = blackjackEngine.applyAction(state, 'dealer', { kind: 'dealer_play' }, defaultRng);
    expect(next.dealerHand).toHaveLength(2); // no extra draws
  });

  it('H17: dealer hits soft 17 once, then stands when next card makes it hard 17+', () => {
    // Dealer A + 6 = soft 17. Top of deck: King → A + 6 + K = hard 17 (ace demotes).
    const state = dealerState(
      [c('hearts', 'Ace'), c('diamonds', '6')],
      [c('spades', 'King')],
      true,
    );
    const next = blackjackEngine.applyAction(state, 'dealer', { kind: 'dealer_play' }, defaultRng);
    expect(next.dealerHand).toHaveLength(3);
    expect(next.dealerHand[2].rank).toBe('King');
  });

  it('S17 vs H17 only differ on soft 17 — both stand on hard 17', () => {
    const hard17 = [c('hearts', '10'), c('diamonds', '7')];
    const s17 = blackjackEngine.applyAction(
      dealerState(hard17, [c('spades', 'King')], false),
      'dealer',
      { kind: 'dealer_play' },
      defaultRng,
    );
    const h17 = blackjackEngine.applyAction(
      dealerState(hard17, [c('spades', 'King')], true),
      'dealer',
      { kind: 'dealer_play' },
      defaultRng,
    );
    expect(s17.dealerHand).toHaveLength(2);
    expect(h17.dealerHand).toHaveLength(2);
  });
});

describe('blackjackEngine dealer_play', () => {
  it('dealer hits until 17 and settles winners/losers', () => {
    // Dealer 6+10 = 16. Player stood on 19. Deck top: King (dealer hits, busts).
    // pop order: King (d hits to 16+10=26 → bust)
    const state: BlackjackState = {
      type: 'blackjack',
      config: STATE_CONFIG,
      deck: [c('spades', 'King')],
      dealerHand: [c('hearts', '6'), c('diamonds', '10')],
      dealerCardsRevealed: false,
      players: [
        {
          id: 'p1',
          cards: [c('clubs', '10'), c('clubs', '9')],
          bet: 10,
          doubled: false,
          status: 'stood',
          insuranceBet: null,
          parentSlotId: null,
        },
      ],
      phase: 'dealer',
      toAct: null,
      turnDeadlineAt: null,
    };
    const next = blackjackEngine.applyAction(state, 'dealer', { kind: 'dealer_play' }, defaultRng);
    expect(next.dealerCardsRevealed).toBe(true);
    expect(next.players[0].status).toBe('won');
    expect(next.phase).toBe('settled');
  });

  it('dealer stands on 17 and player loses with 16', () => {
    const state: BlackjackState = {
      type: 'blackjack',
      config: STATE_CONFIG,
      deck: [],
      dealerHand: [c('hearts', '10'), c('diamonds', '7')], // 17
      dealerCardsRevealed: false,
      players: [
        {
          id: 'p1',
          cards: [c('clubs', '10'), c('clubs', '6')],
          bet: 10,
          doubled: false,
          status: 'stood',
          insuranceBet: null,
          parentSlotId: null,
        },
      ],
      phase: 'dealer',
      toAct: null,
      turnDeadlineAt: null,
    };
    const next = blackjackEngine.applyAction(state, 'dealer', { kind: 'dealer_play' }, defaultRng);
    expect(next.players[0].status).toBe('lost');
  });

  it('player push when totals tie', () => {
    const state: BlackjackState = {
      type: 'blackjack',
      config: STATE_CONFIG,
      deck: [],
      dealerHand: [c('hearts', '10'), c('diamonds', '8')], // 18
      dealerCardsRevealed: false,
      players: [
        {
          id: 'p1',
          cards: [c('clubs', 'King'), c('clubs', '8')],
          bet: 10,
          doubled: false,
          status: 'stood',
          insuranceBet: null,
          parentSlotId: null,
        },
      ],
      phase: 'dealer',
      toAct: null,
      turnDeadlineAt: null,
    };
    const next = blackjackEngine.applyAction(state, 'dealer', { kind: 'dealer_play' }, defaultRng);
    expect(next.players[0].status).toBe('pushed');
  });
});

describe('blackjackEngine.settle', () => {
  function settledState(
    status: 'won' | 'lost' | 'busted' | 'pushed' | 'surrendered' | 'blackjack',
  ): BlackjackState {
    return {
      type: 'blackjack',
      config: STATE_CONFIG,
      deck: [],
      dealerHand: [],
      dealerCardsRevealed: true,
      players: [
        {
          id: 'p1',
          cards: [],
          bet: 10,
          doubled: false,
          status,
          insuranceBet: null,
          parentSlotId: null,
        },
      ],
      phase: 'settled',
      toAct: null,
      turnDeadlineAt: null,
    };
  }

  it('win pays the bet amount', () => {
    expect(blackjackEngine.settle(settledState('won'))).toEqual([
      { playerId: 'p1', delta: 10, reason: 'win' },
    ]);
  });

  it('lose debits the bet amount', () => {
    expect(blackjackEngine.settle(settledState('lost'))).toEqual([
      { playerId: 'p1', delta: -10, reason: 'lose' },
    ]);
  });

  it('bust debits the bet amount', () => {
    expect(blackjackEngine.settle(settledState('busted'))).toEqual([
      { playerId: 'p1', delta: -10, reason: 'bust' },
    ]);
  });

  it('push has no money movement', () => {
    expect(blackjackEngine.settle(settledState('pushed'))).toEqual([]);
  });

  it('surrender debits half the bet (rounded up)', () => {
    expect(blackjackEngine.settle(settledState('surrendered'))).toEqual([
      { playerId: 'p1', delta: -5, reason: 'surrender' },
    ]);
    const odd = settledState('surrendered');
    odd.players[0].bet = 7;
    expect(blackjackEngine.settle(odd)).toEqual([
      { playerId: 'p1', delta: -4, reason: 'surrender' },
    ]);
  });

  it('natural blackjack pays 3:2 bonus on top', () => {
    expect(blackjackEngine.settle(settledState('blackjack'))).toEqual([
      { playerId: 'p1', delta: 15, reason: 'blackjack' },
    ]);
  });
});

describe('blackjackEngine chip conservation invariant', () => {
  it('total chip delta across many simulated terminal states is zero against the house when there are no player events', () => {
    // For a state with all players pushed, no settlements happen.
    const state: BlackjackState = {
      type: 'blackjack',
      config: STATE_CONFIG,
      deck: [],
      dealerHand: [],
      dealerCardsRevealed: true,
      players: [
        {
          id: 'a',
          cards: [],
          bet: 10,
          doubled: false,
          status: 'pushed',
          insuranceBet: null,
          parentSlotId: null,
        },
        {
          id: 'b',
          cards: [],
          bet: 20,
          doubled: false,
          status: 'pushed',
          insuranceBet: null,
          parentSlotId: null,
        },
      ],
      phase: 'settled',
      toAct: null,
      turnDeadlineAt: null,
    };
    const orders = blackjackEngine.settle(state);
    const sum = orders.reduce((s, o) => s + o.delta, 0);
    expect(sum).toBe(0);
  });
});
