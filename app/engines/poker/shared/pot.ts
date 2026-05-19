import { compareHandRanks, type HandRank } from './types';

/**
 * Pot and side-pot reconstruction from per-actor contribution totals.
 *
 * The mechanic: when an all-in actor contributes less than the highest
 * bet on the table, the excess goes into a *side pot* that the all-in
 * actor isn't eligible to win. Side pots layer naturally — multiple
 * all-ins at different chip stacks create multiple side pots.
 *
 * This module is fed contribution totals at showdown and emits a list of
 * pots, each with the set of eligible (non-folded) players. Distribution
 * happens in a second step using each engine's hand-evaluation result.
 */

export type PotContribution = {
  /** Stable id (hand_seat id, possibly with split suffix). */
  id: string;
  /** Total chips this actor put into the pot across all rounds. */
  totalBet: number;
  /** True if the actor folded (chips still go to pot but they can't win). */
  folded: boolean;
};

export type Pot = {
  /** Total chip value of this pot. */
  amount: number;
  /** Actors eligible to win this pot (didn't fold AND reached this level). */
  eligible: string[];
};

/**
 * Build the main pot + any side pots from contribution data.
 *
 * Algorithm: walk through each unique `totalBet` level ascending. At each
 * level, every actor who contributed at least that much puts in the
 * level-difference for this pot. Non-folded contributors are eligible to
 * win it. Folded contributors' chips still funnel through.
 *
 * Examples:
 *   3 players each bet 50 (none folded, none all-in)
 *     → one pot of 150, all 3 eligible.
 *
 *   Player A all-in for 20, B+C bet 50, B folds at end
 *     → main pot 60 (3 × 20), eligible: A, C (B folded)
 *     → side pot 60 (2 × 30), eligible: C   (A wasn't in past 20; B folded)
 */
export function buildPots(contributions: PotContribution[]): Pot[] {
  const positive = contributions.filter((c) => c.totalBet > 0);
  if (positive.length === 0) return [];

  const uniqueLevels = [...new Set(positive.map((c) => c.totalBet))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let processedTo = 0;

  for (const level of uniqueLevels) {
    const diff = level - processedTo;
    if (diff <= 0) continue;
    const contributorsAtLevel = positive.filter((c) => c.totalBet >= level);
    const amount = diff * contributorsAtLevel.length;
    const eligible = contributorsAtLevel.filter((c) => !c.folded).map((c) => c.id);
    pots.push({ amount, eligible });
    processedTo = level;
  }

  return pots;
}

export type PotAward = {
  /** Pot index (0 = main, 1+ = side pots in order). */
  potIndex: number;
  /** Recipient id. */
  id: string;
  /** Chips this recipient gets from this pot. */
  amount: number;
  /** Hand-rank summary for audit / display. */
  rank: HandRank | null;
};

/**
 * Distribute pots to the highest-ranked eligible actor in each. Ties
 * split evenly; any odd remainder goes to the first tied id in
 * seat-order (the `seatOrder` argument).
 *
 * Pots whose only eligible player has folded already (uncontested) award
 * back to that player implicitly via `buildPots` — they're the only
 * eligible id.
 */
export function distributePots(
  pots: Pot[],
  handRanks: ReadonlyMap<string, HandRank>,
  seatOrder: string[],
): PotAward[] {
  const awards: PotAward[] = [];
  pots.forEach((pot, potIndex) => {
    if (pot.eligible.length === 0) {
      // Should not happen — every pot has at least one eligible (the
      // contributor whose level created it). Skip defensively.
      return;
    }

    // Pick the best ranked among eligible. If an eligible has no rank
    // (e.g. only one left after others folded), they win uncontested.
    const ranked = pot.eligible.map((id) => ({ id, rank: handRanks.get(id) ?? null }));
    const haveRanks = ranked.filter((r) => r.rank !== null) as Array<{ id: string; rank: HandRank }>;

    let winners: { id: string; rank: HandRank | null }[];
    if (haveRanks.length === 0) {
      // No ranked hands (everyone in this pot folded except…) — split
      // evenly among the eligible list.
      winners = ranked;
    } else {
      // Find max rank, then all tied.
      let bestRank: HandRank = haveRanks[0].rank;
      for (const r of haveRanks) {
        if (compareHandRanks(r.rank, bestRank) > 0) bestRank = r.rank;
      }
      const tied = haveRanks.filter((r) => compareHandRanks(r.rank, bestRank) === 0);
      winners = tied;
    }

    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;

    // Order winners by seat order for stable remainder distribution.
    const ordered = winners
      .map((w) => ({
        ...w,
        seatIdx: seatOrder.indexOf(w.id),
      }))
      .sort((a, b) => a.seatIdx - b.seatIdx);

    for (const w of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      awards.push({
        potIndex,
        id: w.id,
        amount: share + extra,
        rank: w.rank,
      });
    }
  });

  return awards;
}
