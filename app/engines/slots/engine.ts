import type { GameEngine, RNG, SettlementOrder } from '../types';
import {
  PAYOUT_MULTIPLIER,
  SLOT_SYMBOLS,
  type PayoutKind,
  type SlotsAction,
  type SlotsConfig,
  type SlotsPlayerSlot,
  type SlotsState,
  type SlotsView,
  type SlotsSymbol,
} from './types';

/**
 * Three-reel slot machine engine. Equal-weight RNG on each reel — no
 * weighted symbol tables for now. House edge falls naturally out of the
 * payout multipliers.
 */

function evaluate(reels: SlotsSymbol[]): PayoutKind {
  if (reels.length !== 3) return 'lose';
  const [a, b, c] = reels;
  if (a === b && b === c) {
    switch (a) {
      case 'cherry':
        return 'three_cherry';
      case 'lemon':
        return 'three_lemon';
      case 'bell':
        return 'three_bell';
      case 'bar':
        return 'three_bar';
      case 'seven':
        return 'three_seven';
    }
  }
  // Two sevens (any position) as a consolation payout.
  const sevens = reels.filter((s) => s === 'seven').length;
  if (sevens >= 2) return 'two_seven';
  return 'lose';
}

function spinReels(rng: RNG): SlotsSymbol[] {
  const reels: SlotsSymbol[] = [];
  for (let i = 0; i < 3; i++) {
    reels.push(SLOT_SYMBOLS[rng.randInt(SLOT_SYMBOLS.length)]);
  }
  return reels;
}

function deepClone(state: SlotsState): SlotsState {
  return {
    ...state,
    config: { ...state.config },
    players: state.players.map((p) => ({ ...p, reels: [...p.reels] })),
  };
}

export const slotsEngine: GameEngine<SlotsState, SlotsAction, SlotsView, SlotsConfig> = {
  id: 'slots',

  initialState(config, playerIds) {
    if (playerIds.length !== 1) {
      throw new Error('slots: exactly one player required (single-seat game)');
    }
    const players: SlotsPlayerSlot[] = playerIds.map((id) => ({
      id,
      stake: 0,
      reels: [],
      winnings: 0,
      payoutKind: null,
    }));
    return {
      type: 'slots',
      config: { minimumBet: config.minimumBet, maximumBet: config.maximumBet },
      players,
      phase: 'awaiting_bet',
      toAct: players[0].id,
    };
  },

  legalActions(state, who) {
    if (who === 'spectator') return [];
    if (state.phase !== 'awaiting_bet') return [];
    if (state.toAct !== who) return [];
    return [{ kind: 'spin', playerId: who, amount: state.config.minimumBet }];
  },

  applyAction(state, who, action, rng) {
    if (state.phase !== 'awaiting_bet') {
      throw new Error(`slots: cannot act in phase ${state.phase}`);
    }
    if (state.toAct !== who || action.playerId !== who) {
      throw new Error('slots: not your turn');
    }
    if (!Number.isInteger(action.amount) || action.amount <= 0) {
      throw new Error('slots: bet amount must be a positive integer');
    }
    if (action.amount < state.config.minimumBet) {
      throw new Error(
        `slots: bet ${action.amount} below table minimum (${state.config.minimumBet})`,
      );
    }
    if (action.amount > state.config.maximumBet) {
      throw new Error(
        `slots: bet ${action.amount} above table maximum (${state.config.maximumBet})`,
      );
    }
    const next = deepClone(state);
    const slot = next.players[0];
    slot.stake = action.amount;
    slot.reels = spinReels(rng);
    slot.payoutKind = evaluate(slot.reels);
    slot.winnings = action.amount * PAYOUT_MULTIPLIER[slot.payoutKind];
    next.phase = 'settled';
    next.toAct = null;
    return next;
  },

  viewFor(state, viewer) {
    const legalActions = viewer === 'spectator' ? [] : slotsEngine.legalActions(state, viewer);
    return {
      type: 'slots',
      config: { ...state.config },
      players: state.players.map((p) => ({ ...p, reels: [...p.reels] })),
      phase: state.phase,
      toAct: state.toAct,
      legalActions,
    };
  },

  isTerminal(state) {
    return state.phase === 'settled';
  },

  settle(state): SettlementOrder[] {
    const orders: SettlementOrder[] = [];
    for (const p of state.players) {
      // delta = winnings - stake. Loss → -stake, payout → winnings - stake.
      const delta = p.winnings - p.stake;
      const reason = p.winnings > 0 ? 'win' : 'lose';
      orders.push({ playerId: p.id, delta, reason });
    }
    return orders;
  },
};
