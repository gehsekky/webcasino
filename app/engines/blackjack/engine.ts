import type { GameEngine, RNG, SettlementOrder } from '../types';
import type {
  BlackjackState,
  BlackjackAction,
  BlackjackView,
  BlackjackConfig,
  PlayerSlot,
} from './types';
import type { CardData, Suit, Rank } from 'lib/gameState';
import Card from 'lib/Card';

const SUITS: Suit[] = ['hearts', 'spades', 'clubs', 'diamonds'];
const RANKS: Rank[] = [
  'Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King',
];

function freshDeck(): CardData[] {
  const cards: CardData[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ suit, rank });
    }
  }
  return cards;
}

function freshShoe(numDecks: number): CardData[] {
  const cards: CardData[] = [];
  for (let i = 0; i < numDecks; i++) {
    cards.push(...freshDeck());
  }
  return cards;
}

function shuffle(deck: CardData[], rng: RNG): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.randInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function handTotal(cards: CardData[]): number {
  return Card.getTotal(cards as unknown as Card[]);
}

function handTotalDetail(cards: CardData[]): { total: number; isSoft: boolean } {
  let sum = 0;
  let aceCount = 0;
  for (const card of cards) {
    if (card.rank === 'Ace') {
      sum += 1;
      aceCount += 1;
    } else if (card.rank === 'Jack' || card.rank === 'Queen' || card.rank === 'King') {
      sum += 10;
    } else if (card.rank === 'hidden') {
      // contributes 0
    } else {
      sum += parseInt(card.rank, 10);
    }
  }
  let isSoft = false;
  if (aceCount > 0 && sum + 10 <= 21) {
    sum += 10;
    isSoft = true;
  }
  return { total: sum, isSoft };
}

function isBust(cards: CardData[]): boolean {
  return handTotal(cards) > 21;
}

function isNatural(cards: CardData[]): boolean {
  return cards.length === 2 && handTotal(cards) === 21;
}

function findPlayer(state: BlackjackState, id: string): PlayerSlot {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) {
    throw new Error(`blackjack: unknown player ${id}`);
  }
  return p;
}

function draw(deck: CardData[]): CardData {
  const c = deck.pop();
  if (!c) {
    throw new Error('blackjack: deck empty');
  }
  return c;
}

function nextActive(state: BlackjackState): string | null {
  for (const p of state.players) {
    if (p.status === 'in_hand') return p.id;
  }
  return null;
}

function firstPendingInsurance(state: BlackjackState): string | null {
  for (const p of state.players) {
    if (p.insuranceBet === null) return p.id;
  }
  return null;
}

function firstPendingBet(state: BlackjackState): string | null {
  for (const p of state.players) {
    if (p.status === 'awaiting_bet') return p.id;
  }
  return null;
}

function deepClone(state: BlackjackState): BlackjackState {
  return {
    ...state,
    deck: state.deck.map((c) => ({ ...c })),
    dealerHand: state.dealerHand.map((c) => ({ ...c })),
    players: state.players.map((p) => ({ ...p, cards: p.cards.map((c) => ({ ...c })) })),
    config: { ...state.config },
  };
}

export const blackjackEngine: GameEngine<BlackjackState, BlackjackAction, BlackjackView, BlackjackConfig> = {
  id: 'blackjack',

  initialState(config, playerIds, rng) {
    const numDecks = config.numDecks ?? 1;
    const deck = freshShoe(numDecks);
    shuffle(deck, rng);
    const players: PlayerSlot[] = playerIds.map((id) => ({
      id,
      cards: [],
      bet: 0,
      doubled: false,
      status: 'awaiting_bet',
      insuranceBet: null,
      parentSlotId: null,
    }));
    const initial: BlackjackState = {
      type: 'blackjack',
      config: {
        minimumBet: config.minimumBet,
        maximumBet: config.maximumBet,
        numDecks,
        dealerHitsSoft17: config.dealerHitsSoft17 ?? false,
      },
      deck,
      dealerHand: [],
      dealerCardsRevealed: false,
      players,
      phase: 'awaiting_bets',
      toAct: null,
    };
    initial.toAct = firstPendingBet(initial);
    return initial;
  },

  legalActions(state, who) {
    if (who === 'spectator') return [];
    if (state.phase === 'awaiting_bets') {
      const p = state.players.find((pl) => pl.id === who);
      if (!p || p.status !== 'awaiting_bet') return [];
      // Caller picks an amount; engine validates inside applyAction.
      return [{ kind: 'place_bet', playerId: who, amount: state.config.minimumBet }];
    }
    if (state.phase === 'insurance_offered') {
      const p = state.players.find((pl) => pl.id === who);
      if (!p || p.insuranceBet !== null) return [];
      // The amount is variable (1..floor(bet/2)); caller picks.
      return [
        { kind: 'take_insurance', playerId: who, amount: Math.max(1, Math.floor(p.bet / 2)) },
        { kind: 'decline_insurance', playerId: who },
      ];
    }
    if (state.phase === 'playing' && state.toAct === who) {
      const p = findPlayer(state, who);
      const acts: BlackjackAction[] = [
        { kind: 'hit', playerId: who },
        { kind: 'stay', playerId: who },
      ];
      if (p.cards.length === 2 && !p.doubled) {
        acts.push({ kind: 'double_down', playerId: who });
        const hasSplitSibling = state.players.some((o) => o.parentSlotId === p.id);
        // Split: same-rank pair on the first two cards. Resplits disabled
        // for now (parentSlotId / hasSplitSibling guards); standard
        // re-split rules can come back as a config flag later.
        if (
          p.cards[0].rank === p.cards[1].rank &&
          !p.parentSlotId &&
          !hasSplitSibling
        ) {
          acts.push({ kind: 'split', playerId: who });
        }
        // Surrender is only legal pre-action on a fresh, never-split hand.
        if (!p.parentSlotId && !hasSplitSibling) {
          acts.push({ kind: 'surrender', playerId: who });
        }
      }
      return acts;
    }
    return [];
  },

  applyAction(state, who, action) {
    const next = deepClone(state);

    switch (action.kind) {
      case 'place_bet': {
        if (next.phase !== 'awaiting_bets') {
          throw new Error('blackjack: cannot bet outside the awaiting_bets phase');
        }
        const p = findPlayer(next, action.playerId);
        if (p.status !== 'awaiting_bet') {
          throw new Error(`blackjack: player ${action.playerId} already bet`);
        }
        if (!Number.isInteger(action.amount) || action.amount <= 0) {
          throw new Error('blackjack: bet must be a positive integer');
        }
        if (action.amount < next.config.minimumBet) {
          throw new Error(`blackjack: bet below table minimum (${next.config.minimumBet})`);
        }
        if (action.amount > next.config.maximumBet) {
          throw new Error(`blackjack: bet above table maximum (${next.config.maximumBet})`);
        }
        p.bet = action.amount;
        p.status = 'in_hand';
        // If every player has bet, advance to deal. Otherwise hand off
        // to the next pending bettor (multi-seat tables).
        if (next.players.every((pl) => pl.status === 'in_hand')) {
          return dealInitial(next);
        }
        next.toAct = firstPendingBet(next);
        return next;
      }

      case 'deal_initial': {
        return dealInitial(next);
      }

      case 'take_insurance':
      case 'decline_insurance': {
        if (next.phase !== 'insurance_offered') {
          throw new Error('blackjack: insurance not currently offered');
        }
        const p = findPlayer(next, action.playerId);
        if (p.insuranceBet !== null) {
          throw new Error(`blackjack: player ${action.playerId} already responded to insurance`);
        }
        if (action.kind === 'take_insurance') {
          const maxInsurance = Math.floor(p.bet / 2);
          if (!Number.isInteger(action.amount) || action.amount <= 0) {
            throw new Error('blackjack: insurance amount must be a positive integer');
          }
          if (action.amount > maxInsurance) {
            throw new Error(
              `blackjack: insurance ${action.amount} exceeds the cap (${maxInsurance})`,
            );
          }
          p.insuranceBet = action.amount;
        } else {
          p.insuranceBet = 0;
        }
        // If everyone has decided, resolve. Otherwise advance to the
        // next player still pending an insurance decision.
        if (next.players.every((pl) => pl.insuranceBet !== null)) {
          return resolveInsurance(next);
        }
        next.toAct = firstPendingInsurance(next);
        return next;
      }

      case 'hit': {
        if (next.phase !== 'playing' || next.toAct !== action.playerId) {
          throw new Error('blackjack: not your turn');
        }
        const p = findPlayer(next, action.playerId);
        p.cards.push(draw(next.deck));
        if (isBust(p.cards)) {
          p.status = 'busted';
          next.toAct = nextActive(next);
          if (!next.toAct) return startDealerPhase(next);
        }
        return next;
      }

      case 'stay': {
        if (next.phase !== 'playing' || next.toAct !== action.playerId) {
          throw new Error('blackjack: not your turn');
        }
        const p = findPlayer(next, action.playerId);
        p.status = 'stood';
        next.toAct = nextActive(next);
        if (!next.toAct) return startDealerPhase(next);
        return next;
      }

      case 'double_down': {
        if (next.phase !== 'playing' || next.toAct !== action.playerId) {
          throw new Error('blackjack: not your turn');
        }
        const p = findPlayer(next, action.playerId);
        if (p.cards.length !== 2 || p.doubled) {
          throw new Error('blackjack: can only double on a fresh 2-card hand');
        }
        p.doubled = true;
        p.bet *= 2;
        p.cards.push(draw(next.deck));
        if (isBust(p.cards)) {
          p.status = 'busted';
        } else {
          p.status = 'stood';
        }
        next.toAct = nextActive(next);
        if (!next.toAct) return startDealerPhase(next);
        return next;
      }

      case 'surrender': {
        if (next.phase !== 'playing' || next.toAct !== action.playerId) {
          throw new Error('blackjack: not your turn');
        }
        const p = findPlayer(next, action.playerId);
        if (p.cards.length !== 2) {
          throw new Error('blackjack: can only surrender on the first two cards');
        }
        if (p.parentSlotId || next.players.some((o) => o.parentSlotId === p.id)) {
          throw new Error('blackjack: cannot surrender after a split');
        }
        p.status = 'surrendered';
        next.toAct = nextActive(next);
        if (!next.toAct) return startDealerPhase(next);
        return next;
      }

      case 'split': {
        if (next.phase !== 'playing' || next.toAct !== action.playerId) {
          throw new Error('blackjack: not your turn');
        }
        const p = findPlayer(next, action.playerId);
        if (p.cards.length !== 2) {
          throw new Error('blackjack: can only split on a fresh 2-card hand');
        }
        if (p.cards[0].rank !== p.cards[1].rank) {
          throw new Error('blackjack: split requires two same-rank cards');
        }
        if (p.parentSlotId) {
          throw new Error('blackjack: resplits are not allowed');
        }
        const wasAces = p.cards[0].rank === 'Ace';

        // Lift the second card off the original hand, then draw one new
        // card for each. Standard dealing order: original is dealt first,
        // then the split sibling.
        const lifted = p.cards.pop();
        if (!lifted) throw new Error('blackjack: split: missing second card');
        p.cards.push(draw(next.deck));
        const sibling: PlayerSlot = {
          id: `${p.id}:split:1`,
          cards: [lifted, draw(next.deck)],
          bet: p.bet,
          doubled: false,
          status: wasAces ? 'stood' : 'in_hand',
          insuranceBet: null,
          parentSlotId: p.id,
        };
        if (wasAces) {
          // Standard rule: split aces get exactly one card each, no more.
          p.status = 'stood';
        }
        // Insert sibling immediately after the original so play order is preserved.
        const idx = next.players.findIndex((pl) => pl.id === p.id);
        next.players.splice(idx + 1, 0, sibling);

        if (wasAces) {
          next.toAct = nextActive(next);
          if (!next.toAct) return startDealerPhase(next);
        }
        return next;
      }

      case 'dealer_play': {
        if (next.phase !== 'dealer') {
          throw new Error('blackjack: dealer plays only after all players act');
        }
        return playDealer(next);
      }
    }
  },

  viewFor(state, viewer) {
    const cloned = deepClone(state);
    if (!cloned.dealerCardsRevealed && cloned.dealerHand.length > 0) {
      cloned.dealerHand[0] = { suit: 'hidden', rank: 'hidden' };
    }

    let legalActions: BlackjackAction[] = [];
    if (viewer !== 'spectator') {
      if (state.phase === 'awaiting_bets' || state.phase === 'insurance_offered') {
        // Pre-deal phases reference the viewer's primary slot directly.
        legalActions = blackjackEngine.legalActions(state, viewer);
      } else if (state.phase === 'playing') {
        // After splitting, the viewer may own multiple slots. Pick whichever
        // is currently to act and emit *that* slot's legal actions.
        const acting = state.players.find(
          (p) => (p.id === viewer || p.parentSlotId === viewer) && p.id === state.toAct,
        );
        if (acting) {
          legalActions = blackjackEngine.legalActions(state, acting.id);
        }
      }
    }

    return {
      type: 'blackjack',
      config: cloned.config,
      dealerHand: cloned.dealerHand,
      dealerCardsRevealed: cloned.dealerCardsRevealed,
      players: cloned.players,
      phase: cloned.phase,
      toAct: cloned.toAct,
      legalActions,
    };
  },

  isTerminal(state) {
    return state.phase === 'settled';
  },

  aiAction(state, slotId): BlackjackAction {
    return blackjackAiAction(state, slotId);
  },

  settle(state) {
    const orders: SettlementOrder[] = [];
    for (const p of state.players) {
      switch (p.status) {
        case 'blackjack':
          // Natural pays 3:2 on top of the original wager (bet itself isn't moved).
          orders.push({ playerId: p.id, delta: Math.floor(p.bet * 1.5), reason: 'blackjack' });
          break;
        case 'won':
          orders.push({ playerId: p.id, delta: p.bet, reason: 'win' });
          break;
        case 'lost':
          orders.push({ playerId: p.id, delta: -p.bet, reason: 'lose' });
          break;
        case 'busted':
          orders.push({ playerId: p.id, delta: -p.bet, reason: 'bust' });
          break;
        case 'pushed':
          // No movement on push.
          break;
        case 'surrendered':
          orders.push({ playerId: p.id, delta: -Math.ceil(p.bet / 2), reason: 'surrender' });
          break;
        default:
          throw new Error(`blackjack settle: unsettled status ${p.status} for player ${p.id}`);
      }
    }
    return orders;
  },
};

function dealInitial(state: BlackjackState): BlackjackState {
  for (const p of state.players) {
    p.cards.push(draw(state.deck));
    p.cards.push(draw(state.deck));
  }
  state.dealerHand.push(draw(state.deck));
  state.dealerHand.push(draw(state.deck));

  // If dealer up-card is Ace, offer insurance before resolving naturals.
  // (dealerHand[0] is the hole card; dealerHand[1] is the face-up card.)
  const upCard = state.dealerHand[1];
  if (upCard.rank === 'Ace') {
    state.phase = 'insurance_offered';
    state.toAct = firstPendingInsurance(state);
    return state;
  }

  return resolveDealerPeekAndContinue(state);
}

function resolveInsurance(state: BlackjackState): BlackjackState {
  return resolveDealerPeekAndContinue(state);
}

/**
 * Peek at the dealer's hole card. If dealer has a natural blackjack, settle
 * immediately. Otherwise mark any player naturals and advance to the
 * playing phase (or skip straight to dealer if every player got a natural).
 *
 * Called from `dealInitial` when the up-card isn't an Ace, and from
 * `resolveInsurance` after all players have responded to insurance.
 */
function resolveDealerPeekAndContinue(state: BlackjackState): BlackjackState {
  if (isNatural(state.dealerHand)) {
    state.dealerCardsRevealed = true;
    for (const p of state.players) {
      if (isNatural(p.cards)) {
        p.status = 'pushed';
      } else {
        p.status = 'lost';
      }
    }
    state.phase = 'settled';
    return state;
  }

  for (const p of state.players) {
    if (isNatural(p.cards)) {
      p.status = 'blackjack';
    }
  }

  state.phase = 'playing';
  state.toAct = nextActive(state);
  if (!state.toAct) {
    // Every player got a natural; skip to dealer reveal + settle.
    return startDealerPhase(state);
  }
  return state;
}

function startDealerPhase(state: BlackjackState): BlackjackState {
  state.phase = 'dealer';
  state.toAct = null;
  return state;
}

/**
 * Simple "basic-strategy-lite" AI for blackjack.
 *
 *   awaiting_bets       → place_bet at table minimum
 *   insurance_offered   → decline (insurance has a negative house edge)
 *   playing:
 *     hand <= 11        → hit
 *     hand 12-16        → stand vs dealer 2-6, hit vs 7-A (strong)
 *     hand 17+          → stand
 *
 * Doesn't double down, split, or surrender — those add asymmetric EV
 * decisions that we'll layer in once tuning matters. Soft totals share
 * the same threshold as hard for now (good enough; basic strategy
 * variants can land later behind a config flag).
 */
function blackjackAiAction(state: BlackjackState, slotId: string): BlackjackAction {
  if (state.phase === 'awaiting_bets') {
    return { kind: 'place_bet', playerId: slotId, amount: state.config.minimumBet };
  }
  if (state.phase === 'insurance_offered') {
    return { kind: 'decline_insurance', playerId: slotId };
  }
  if (state.phase === 'playing') {
    const slot = state.players.find((p) => p.id === slotId);
    if (!slot) throw new Error(`blackjack AI: unknown slot ${slotId}`);

    const total = handTotal(slot.cards);
    if (total >= 17) return { kind: 'stay', playerId: slotId };
    if (total <= 11) return { kind: 'hit', playerId: slotId };

    // 12-16: depend on dealer up-card. dealerHand[0] is the hole card
    // (masked from the AI just like it's masked from humans during play);
    // dealerHand[1] is the face-up card.
    const upCard = state.dealerHand[1];
    const dealerValue = upCard ? handTotal([upCard]) : 0;
    const dealerWeak = dealerValue >= 2 && dealerValue <= 6;
    return dealerWeak
      ? { kind: 'stay', playerId: slotId }
      : { kind: 'hit', playerId: slotId };
  }
  throw new Error(`blackjack AI: cannot act in phase ${state.phase}`);
}

function playDealer(state: BlackjackState): BlackjackState {
  state.dealerCardsRevealed = true;
  // S17: dealer stands on all 17. H17: dealer hits *soft* 17.
  for (;;) {
    const detail = handTotalDetail(state.dealerHand);
    const shouldHit =
      detail.total < 17 ||
      (detail.total === 17 && detail.isSoft && state.config.dealerHitsSoft17);
    if (!shouldHit) break;
    state.dealerHand.push(draw(state.deck));
  }
  const dealerTotal = handTotal(state.dealerHand);
  const dealerBusted = dealerTotal > 21;

  for (const p of state.players) {
    if (p.status === 'busted' || p.status === 'surrendered' || p.status === 'lost' || p.status === 'pushed' || p.status === 'won' || p.status === 'blackjack') {
      // Already settled.
      continue;
    }
    const playerTotal = handTotal(p.cards);
    if (dealerBusted || playerTotal > dealerTotal) {
      p.status = 'won';
    } else if (playerTotal < dealerTotal) {
      p.status = 'lost';
    } else {
      p.status = 'pushed';
    }
  }
  state.phase = 'settled';
  return state;
}
