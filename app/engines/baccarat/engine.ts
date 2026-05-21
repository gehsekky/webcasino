import { randomUUID } from 'node:crypto';
import type { GameEngine, RNG, SettlementOrder } from '../types';
import type { CardData, Suit, Rank } from 'lib/gameState';
import {
  BACCARAT_PAYOUT,
  BANKER_COMMISSION,
  bankerDraws,
  cardValue,
  handTotal,
  type BaccaratAction,
  type BaccaratBet,
  type BaccaratBetKind,
  type BaccaratConfig,
  type BaccaratPlayerSlot,
  type BaccaratState,
  type BaccaratView,
} from './types';

const SUITS: Suit[] = ['hearts', 'spades', 'clubs', 'diamonds'];
const RANKS: Rank[] = [
  'Ace',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'Jack',
  'Queen',
  'King',
];

function freshShoe(numDecks: number): CardData[] {
  const cards: CardData[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ suit, rank });
      }
    }
  }
  return cards;
}

function shuffle(deck: CardData[], rng: RNG): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.randInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function draw(deck: CardData[]): CardData {
  const c = deck.pop();
  if (!c) throw new Error('baccarat: deck empty');
  return c;
}

function deepClone(state: BaccaratState): BaccaratState {
  return {
    ...state,
    config: { ...state.config },
    deck: state.deck.map((c) => ({ ...c })),
    playerHand: state.playerHand.map((c) => ({ ...c })),
    bankerHand: state.bankerHand.map((c) => ({ ...c })),
    players: state.players.map((p) => ({
      ...p,
      bets: p.bets.map((b) => ({ ...b })),
    })),
  };
}

function validateBet(
  bet: { kind: BaccaratBetKind; amount: number },
  cfg: BaccaratState['config'],
): void {
  if (!Number.isInteger(bet.amount) || bet.amount <= 0) {
    throw new Error('baccarat: bet amount must be a positive integer');
  }
  if (bet.amount < cfg.minimumBet) {
    throw new Error(`baccarat: bet ${bet.amount} below table minimum (${cfg.minimumBet})`);
  }
  if (bet.amount > cfg.maximumBet) {
    throw new Error(`baccarat: bet ${bet.amount} above table maximum (${cfg.maximumBet})`);
  }
}

/**
 * Run a full Punto Banco deal — deals 2 to Player + 2 to Banker, applies
 * the third-card tableau if neither side has a natural 8/9, then writes
 * outcome + totals + per-bet payouts into the cloned state.
 */
function applyDeal(state: BaccaratState): BaccaratState {
  const next = deepClone(state);
  const deck = next.deck;

  // Initial deal — alternating like a real shoe (Player first).
  next.playerHand.push(draw(deck));
  next.bankerHand.push(draw(deck));
  next.playerHand.push(draw(deck));
  next.bankerHand.push(draw(deck));

  const playerTwoCard = handTotal(next.playerHand);
  const bankerTwoCard = handTotal(next.bankerHand);

  // Natural 8 or 9 on either side ends the hand immediately.
  const naturalHalt = playerTwoCard >= 8 || bankerTwoCard >= 8;

  if (!naturalHalt) {
    // Player's third-card rule: draw on 0–5, stand on 6–7.
    let playerThirdValue: number | null = null;
    if (playerTwoCard <= 5) {
      const third = draw(deck);
      next.playerHand.push(third);
      playerThirdValue = cardValue(third);
    }

    // Banker's decision depends on banker's two-card total and the
    // Player's third card (or absence thereof).
    if (bankerDraws(bankerTwoCard, playerThirdValue)) {
      next.bankerHand.push(draw(deck));
    }
  }

  const playerTotal = handTotal(next.playerHand);
  const bankerTotal = handTotal(next.bankerHand);
  next.playerTotal = playerTotal;
  next.bankerTotal = bankerTotal;

  const outcome =
    playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie';
  next.outcome = outcome;

  // Resolve every bet on the table.
  for (const slot of next.players) {
    for (const bet of slot.bets) {
      bet.payout = 0;
      bet.pushed = false;
      if (bet.kind === 'tie') {
        if (outcome === 'tie') {
          // Tie bets pay tiePayout:1 plus return the stake.
          bet.payout = bet.amount * (next.config.tiePayout + 1);
          slot.winnings += bet.payout;
        }
      } else if (bet.kind === 'player') {
        if (outcome === 'player') {
          // 1:1 — pay 2× stake (winnings + returned stake).
          bet.payout = bet.amount * (1 + BACCARAT_PAYOUT.player);
          slot.winnings += bet.payout;
        } else if (outcome === 'tie') {
          bet.pushed = true;
          bet.payout = bet.amount;
          slot.winnings += bet.payout;
        }
      } else if (bet.kind === 'banker') {
        if (outcome === 'banker') {
          // Stake + 95% of stake (5% commission, floor-rounded so the
          // house keeps the rounding scrap on odd dollars).
          const winPortion = Math.floor(bet.amount * (1 - BANKER_COMMISSION));
          bet.payout = bet.amount + winPortion;
          slot.winnings += bet.payout;
        } else if (outcome === 'tie') {
          bet.pushed = true;
          bet.payout = bet.amount;
          slot.winnings += bet.payout;
        }
      }
    }
  }

  next.phase = 'settled';
  next.toAct = null;
  return next;
}

export const baccaratEngine: GameEngine<
  BaccaratState,
  BaccaratAction,
  BaccaratView,
  BaccaratConfig
> = {
  id: 'baccarat',

  initialState(config, playerIds, rng) {
    if (playerIds.length < 1) {
      throw new Error('baccarat: need at least one player');
    }
    const numDecks = config.numDecks ?? 8;
    const tiePayout = config.tiePayout ?? 8;
    const deck = freshShoe(numDecks);
    shuffle(deck, rng);

    const players: BaccaratPlayerSlot[] = playerIds.map((id) => ({
      id,
      bets: [],
      totalStake: 0,
      winnings: 0,
    }));

    return {
      type: 'baccarat',
      config: {
        minimumBet: config.minimumBet,
        maximumBet: config.maximumBet,
        numDecks,
        tiePayout,
      },
      deck,
      playerHand: [],
      bankerHand: [],
      players,
      phase: 'awaiting_bets',
      toAct: players[0].id,
      outcome: null,
      playerTotal: null,
      bankerTotal: null,
    };
  },

  legalActions(state, who) {
    if (who === 'spectator') return [];
    if (state.phase !== 'awaiting_bets') return [];
    const p = state.players.find((pl) => pl.id === who);
    if (!p) return [];
    // Anyone can place_bet or call deal until settled. The route layer
    // restricts `deal` to the room creator (same pattern as roulette
    // `spin` — the engine doesn't carry the seat-vs-room-creator
    // distinction).
    return [
      {
        kind: 'place_bet',
        playerId: who,
        bet: { kind: 'player', amount: state.config.minimumBet },
      },
      { kind: 'deal', playerId: who },
    ];
  },

  applyAction(state, who, action) {
    if (state.phase !== 'awaiting_bets') {
      throw new Error(`baccarat: cannot act in phase ${state.phase}`);
    }
    if (action.playerId !== who) {
      throw new Error('baccarat: actor id mismatch');
    }

    if (action.kind === 'place_bet') {
      validateBet(action.bet, state.config);
      const next = deepClone(state);
      const p = next.players.find((pl) => pl.id === who);
      if (!p) throw new Error(`baccarat: unknown player ${who}`);
      const bet: BaccaratBet = {
        id: randomUUID(),
        kind: action.bet.kind,
        amount: action.bet.amount,
        payout: 0,
        pushed: false,
      };
      p.bets.push(bet);
      p.totalStake += bet.amount;
      return next;
    }

    if (action.kind === 'deal') {
      return applyDeal(state);
    }

    throw new Error('baccarat: unknown action kind');
  },

  viewFor(state, viewer) {
    const legalActions = viewer === 'spectator' ? [] : baccaratEngine.legalActions(state, viewer);
    return {
      type: 'baccarat',
      config: { ...state.config },
      players: state.players.map((p) => ({
        ...p,
        bets: p.bets.map((b) => ({ ...b })),
      })),
      playerHand: state.playerHand.map((c) => ({ ...c })),
      bankerHand: state.bankerHand.map((c) => ({ ...c })),
      phase: state.phase,
      toAct: state.toAct,
      outcome: state.outcome,
      playerTotal: state.playerTotal,
      bankerTotal: state.bankerTotal,
      legalActions,
    };
  },

  aiAction(state, slotId, rng): BaccaratAction {
    return baccaratAiAction(state, slotId, rng);
  },

  isTerminal(state) {
    return state.phase === 'settled';
  },

  settle(state): SettlementOrder[] {
    return state.players.map((p) => {
      const delta = p.winnings - p.totalStake;
      const reason = p.winnings > 0 ? (delta > 0 ? 'win' : 'push') : 'lose';
      return { playerId: p.id, delta, reason };
    });
  },
};

/**
 * Casual-play AI: 45/45 Player/Banker, 10% Tie. Amount between the
 * table minimum and 3× minimum, capped at the table maximum. The
 * wrapper calls this 1–3 times per AI slot at hand start.
 */
function baccaratAiAction(state: BaccaratState, slotId: string, rng: RNG): BaccaratAction {
  const min = state.config.minimumBet;
  const cap = Math.min(state.config.maximumBet, min * 3);
  const amount = cap > min ? min + rng.randInt(cap - min + 1) : min;
  const roll = rng.randInt(100);
  const kind: BaccaratBetKind = roll < 45 ? 'player' : roll < 90 ? 'banker' : 'tie';
  return { kind: 'place_bet', playerId: slotId, bet: { kind, amount } };
}
