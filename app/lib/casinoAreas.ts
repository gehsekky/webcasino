/**
 * Casino areas. Each "area" is a UI concept that maps to a set of game
 * configurations with consistent bet ranges. The server uses these
 * configs when provisioning a new hand so the resulting `casino_table`
 * has the correct min/max for the area.
 *
 * Areas are not persisted — they're a navigation/grouping abstraction.
 * To add an area, append to `AREAS`.
 */

export type GameId = 'blackjack' | 'poker' | 'slots';

export type AreaGame = {
  id: GameId;
  name: string;
  blurb: string;
  minimumBet: number;
  maximumBet: number;
  available: boolean;
};

export type AreaId = 'low-rollers' | 'high-rollers';

export type CasinoArea = {
  id: AreaId;
  name: string;
  tagline: string;
  description: string;
  /** Tailwind classes that define the area's visual identity. */
  theme: {
    /** Page background gradient classes. */
    pageBg: string;
    /** Lobby card background + ring classes. */
    cardBg: string;
    /** Accent colour for headlines/badges. */
    accentText: string;
    /** Hover state for the area card. */
    cardHover: string;
  };
  games: AreaGame[];
};

export const AREAS: CasinoArea[] = [
  {
    id: 'low-rollers',
    name: 'Low Rollers Lounge',
    tagline: '$1 – $100',
    description:
      'Casual stakes, low pressure. Learn the games and warm up the bankroll.',
    theme: {
      pageBg: 'from-emerald-950 via-emerald-900 to-emerald-950',
      cardBg: 'bg-emerald-900/50 ring-emerald-700/60',
      accentText: 'text-emerald-300',
      cardHover: 'hover:bg-emerald-800/60 hover:ring-emerald-500',
    },
    games: [
      {
        id: 'blackjack',
        name: 'Blackjack',
        blurb: 'Standard rules. 3:2 naturals, dealer stands on 17.',
        minimumBet: 1,
        maximumBet: 100,
        available: true,
      },
      {
        id: 'slots',
        name: 'Slots',
        blurb: 'Spin to win. Penny denominations.',
        minimumBet: 1,
        maximumBet: 25,
        available: false,
      },
      {
        id: 'poker',
        name: 'Poker',
        blurb: 'Texas Hold’em, low-limit.',
        minimumBet: 2,
        maximumBet: 50,
        available: false,
      },
    ],
  },
  {
    id: 'high-rollers',
    name: 'High Rollers Salon',
    tagline: '$100 minimum',
    description:
      'High-limit tables. Bring your bankroll — the upper limit is whatever you brought to the table.',
    theme: {
      pageBg: 'from-slate-950 via-purple-950 to-slate-950',
      cardBg: 'bg-slate-900/60 ring-amber-500/30',
      accentText: 'text-amber-300',
      cardHover: 'hover:bg-slate-800/70 hover:ring-amber-400',
    },
    games: [
      {
        id: 'blackjack',
        name: 'Blackjack',
        blurb: 'Same rules, bigger stakes.',
        minimumBet: 100,
        maximumBet: 10000,
        available: true,
      },
      {
        id: 'slots',
        name: 'Slots',
        blurb: 'High-denomination machines.',
        minimumBet: 25,
        maximumBet: 1000,
        available: false,
      },
      {
        id: 'poker',
        name: 'Poker',
        blurb: 'High-limit Hold’em.',
        minimumBet: 100,
        maximumBet: 5000,
        available: false,
      },
    ],
  },
];

export function getAreaById(id: string | undefined): CasinoArea | undefined {
  return AREAS.find((a) => a.id === id);
}

export function findGameInArea(area: CasinoArea, gameId: string): AreaGame | undefined {
  return area.games.find((g) => g.id === gameId);
}
