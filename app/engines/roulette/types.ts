/**
 * European single-zero roulette. 37 pockets (0-36). Single hand per
 * spin: players place bets → creator triggers spin → engine resolves all
 * bets → settle.
 */

export type RoulettePhase = 'awaiting_bets' | 'settled';

export type BetKind =
  | 'straight' // single number, pays 35:1
  | 'red' // 1:1
  | 'black' // 1:1
  | 'odd' // 1:1
  | 'even' // 1:1
  | 'low' // 1-18, pays 1:1
  | 'high' // 19-36, pays 1:1
  | 'dozen1' // 1-12, pays 2:1
  | 'dozen2' // 13-24, pays 2:1
  | 'dozen3' // 25-36, pays 2:1
  | 'column1' // 1,4,7,...,34, pays 2:1
  | 'column2' // 2,5,8,...,35, pays 2:1
  | 'column3'; // 3,6,9,...,36, pays 2:1

export const BET_KINDS: readonly BetKind[] = [
  'straight',
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'column1',
  'column2',
  'column3',
] as const;

export const BET_PAYOUT: Record<BetKind, number> = {
  straight: 35,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
  dozen1: 2,
  dozen2: 2,
  dozen3: 2,
  column1: 2,
  column2: 2,
  column3: 2,
};

export const BET_LABEL: Record<BetKind, string> = {
  straight: 'Straight',
  red: 'Red',
  black: 'Black',
  odd: 'Odd',
  even: 'Even',
  low: 'Low (1-18)',
  high: 'High (19-36)',
  dozen1: '1st 12',
  dozen2: '2nd 12',
  dozen3: '3rd 12',
  column1: '1st Col',
  column2: '2nd Col',
  column3: '3rd Col',
};

export type RouletteBet = {
  /** Random id so the UI can render a stable list. */
  id: string;
  kind: BetKind;
  amount: number;
  /** Required for `kind === 'straight'`; absent otherwise. */
  number?: number;
  /** Set at settle: positive = won, 0 = lost. Includes the original stake on a win. */
  payout: number;
};

export type RoulettePlayerSlot = {
  id: string;
  bets: RouletteBet[];
  /** Sum of bet amounts (running stake total). */
  totalStake: number;
  /** Sum of payouts (running winnings). */
  winnings: number;
};

export type RouletteState = {
  type: 'roulette';
  config: {
    minimumBet: number;
    maximumBet: number;
  };
  players: RoulettePlayerSlot[];
  phase: RoulettePhase;
  toAct: string | null;
  /** 0-36 once spun, null before. */
  result: number | null;
};

export type RouletteAction =
  | {
      kind: 'place_bet';
      playerId: string;
      bet: { kind: BetKind; amount: number; number?: number };
    }
  | { kind: 'spin'; playerId: string };

export type RouletteConfig = {
  minimumBet: number;
  maximumBet: number;
};

export type RouletteView = {
  type: 'roulette';
  config: { minimumBet: number; maximumBet: number };
  players: RoulettePlayerSlot[];
  phase: RoulettePhase;
  toAct: string | null;
  result: number | null;
  legalActions: RouletteAction[];
};

/**
 * Returns true iff `n` is colored red in standard European roulette
 * (the layout that excludes 0). Zero is green.
 */
export function isRed(n: number): boolean {
  return new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]).has(n);
}

export function isBlack(n: number): boolean {
  return n !== 0 && !isRed(n);
}
