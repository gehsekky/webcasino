/**
 * Slot-machine engine types. Single-seat, single-spin-per-hand game.
 *
 * Each "hand" at a slots room is one spin: place bet → spin reels →
 * evaluate → settle. The hand_seat-per-round model in the rest of the
 * system fits cleanly — the per-spin row carries the audit trail.
 */

export type SlotsSymbol = 'cherry' | 'lemon' | 'bell' | 'bar' | 'seven';

export const SLOT_SYMBOLS: readonly SlotsSymbol[] = [
  'cherry',
  'lemon',
  'bell',
  'bar',
  'seven',
] as const;

export const SLOT_SYMBOL_GLYPH: Record<SlotsSymbol, string> = {
  cherry: '🍒',
  lemon: '🍋',
  bell: '🔔',
  bar: '🅱',
  seven: '7',
};

/** Multipliers applied to the bet on a winning combination. */
export type PayoutKind =
  | 'three_cherry'
  | 'three_lemon'
  | 'three_bell'
  | 'three_bar'
  | 'three_seven'
  | 'two_seven'
  | 'lose';

export const PAYOUT_MULTIPLIER: Record<PayoutKind, number> = {
  three_cherry: 2,
  three_lemon: 5,
  three_bell: 10,
  three_bar: 25,
  three_seven: 100,
  two_seven: 3,
  lose: 0,
};

export type SlotsPhase = 'awaiting_bet' | 'settled';

export type SlotsPlayerSlot = {
  id: string;
  /** Amount wagered for this spin. 0 before the spin completes. */
  stake: number;
  /** 3 reel symbols, populated post-spin. */
  reels: SlotsSymbol[];
  /** Payout for this spin (0 if lose). */
  winnings: number;
  /** What kind of result was scored — for UI display. */
  payoutKind: PayoutKind | null;
};

export type SlotsState = {
  type: 'slots';
  config: {
    minimumBet: number;
    maximumBet: number;
  };
  /** Single seat; the engine still uses an array so it fits the GameEngine type. */
  players: SlotsPlayerSlot[];
  phase: SlotsPhase;
  toAct: string | null;
};

export type SlotsAction = { kind: 'spin'; playerId: string; amount: number };

export type SlotsConfig = {
  minimumBet: number;
  maximumBet: number;
};

/** View projection — same shape as state for slots (no hidden info). */
export type SlotsView = {
  type: 'slots';
  config: { minimumBet: number; maximumBet: number };
  players: SlotsPlayerSlot[];
  phase: SlotsPhase;
  toAct: string | null;
  legalActions: SlotsAction[];
};
