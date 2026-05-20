import { randomUUID } from 'node:crypto';
import type { GameEngine, SettlementOrder } from '../types';
import {
  BET_PAYOUT,
  isBlack,
  isRed,
  type BetKind,
  type RouletteAction,
  type RouletteBet,
  type RouletteConfig,
  type RoulettePlayerSlot,
  type RouletteState,
  type RouletteView,
} from './types';

/**
 * European single-zero roulette engine. Players accumulate bets during
 * `awaiting_bets`; a single `spin` action picks a 0-36, resolves every
 * placed bet, and settles. Side pots / split-bets / multi-number bets
 * (corner, street) are deliberately omitted for the first version — the
 * 13 bet types here cover the common surfaces and give the engine a
 * clear extension point.
 */

function isWinningBet(bet: RouletteBet, result: number): boolean {
  switch (bet.kind) {
    case 'straight':
      return bet.number === result;
    case 'red':
      return isRed(result);
    case 'black':
      return isBlack(result);
    case 'odd':
      return result !== 0 && result % 2 === 1;
    case 'even':
      return result !== 0 && result % 2 === 0;
    case 'low':
      return result >= 1 && result <= 18;
    case 'high':
      return result >= 19 && result <= 36;
    case 'dozen1':
      return result >= 1 && result <= 12;
    case 'dozen2':
      return result >= 13 && result <= 24;
    case 'dozen3':
      return result >= 25 && result <= 36;
    case 'column1':
      return result !== 0 && result % 3 === 1;
    case 'column2':
      return result !== 0 && result % 3 === 2;
    case 'column3':
      return result !== 0 && result % 3 === 0;
  }
}

function validateBet(
  bet: { kind: BetKind; amount: number; number?: number },
  cfg: RouletteState['config'],
): void {
  if (!Number.isInteger(bet.amount) || bet.amount <= 0) {
    throw new Error('roulette: bet amount must be a positive integer');
  }
  if (bet.amount < cfg.minimumBet) {
    throw new Error(`roulette: bet ${bet.amount} below table minimum (${cfg.minimumBet})`);
  }
  if (bet.amount > cfg.maximumBet) {
    throw new Error(`roulette: bet ${bet.amount} above table maximum (${cfg.maximumBet})`);
  }
  if (bet.kind === 'straight') {
    if (typeof bet.number !== 'number' || bet.number < 0 || bet.number > 36) {
      throw new Error('roulette: straight bet requires a number 0-36');
    }
  } else if (bet.number !== undefined) {
    throw new Error(`roulette: ${bet.kind} bet should not carry a number`);
  }
}

function deepClone(state: RouletteState): RouletteState {
  return {
    ...state,
    config: { ...state.config },
    players: state.players.map((p) => ({
      ...p,
      bets: p.bets.map((b) => ({ ...b })),
    })),
  };
}

export const rouletteEngine: GameEngine<
  RouletteState,
  RouletteAction,
  RouletteView,
  RouletteConfig
> = {
  id: 'roulette',

  initialState(config, playerIds) {
    if (playerIds.length < 1) {
      throw new Error('roulette: need at least one player');
    }
    const players: RoulettePlayerSlot[] = playerIds.map((id) => ({
      id,
      bets: [],
      totalStake: 0,
      winnings: 0,
    }));
    return {
      type: 'roulette',
      config: { minimumBet: config.minimumBet, maximumBet: config.maximumBet },
      players,
      phase: 'awaiting_bets',
      toAct: players[0].id,
      result: null,
    };
  },

  legalActions(state, who) {
    if (who === 'spectator') return [];
    if (state.phase !== 'awaiting_bets') return [];
    const p = state.players.find((pl) => pl.id === who);
    if (!p) return [];
    // Every player can place_bet until the spin happens. We expose a
    // placeholder bet shape; the caller fills in kind/amount/number.
    return [
      { kind: 'place_bet', playerId: who, bet: { kind: 'red', amount: state.config.minimumBet } },
      { kind: 'spin', playerId: who },
    ];
  },

  applyAction(state, who, action, rng) {
    if (state.phase !== 'awaiting_bets') {
      throw new Error(`roulette: cannot act in phase ${state.phase}`);
    }
    if (action.playerId !== who) {
      throw new Error('roulette: actor id mismatch');
    }
    const next = deepClone(state);
    const p = next.players.find((pl) => pl.id === who);
    if (!p) throw new Error(`roulette: unknown player ${who}`);

    if (action.kind === 'place_bet') {
      validateBet(action.bet, next.config);
      const bet: RouletteBet = {
        id: randomUUID(),
        kind: action.bet.kind,
        amount: action.bet.amount,
        number: action.bet.number,
        payout: 0,
      };
      p.bets.push(bet);
      p.totalStake += bet.amount;
      return next;
    }

    if (action.kind === 'spin') {
      const result = rng.randInt(37);
      next.result = result;
      for (const pl of next.players) {
        for (const bet of pl.bets) {
          if (isWinningBet(bet, result)) {
            // Payout includes the original stake (so a 1:1 bet returns 2× the bet).
            const payout = bet.amount * (1 + BET_PAYOUT[bet.kind]);
            bet.payout = payout;
            pl.winnings += payout;
          }
        }
      }
      next.phase = 'settled';
      next.toAct = null;
      return next;
    }

    throw new Error(`roulette: unknown action kind`);
  },

  viewFor(state, viewer) {
    const legalActions = viewer === 'spectator' ? [] : rouletteEngine.legalActions(state, viewer);
    return {
      type: 'roulette',
      config: { ...state.config },
      players: state.players.map((p) => ({
        ...p,
        bets: p.bets.map((b) => ({ ...b })),
      })),
      phase: state.phase,
      toAct: state.toAct,
      result: state.result,
      legalActions,
    };
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
