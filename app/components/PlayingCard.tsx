import type { CardData } from 'lib/gameState';

const SUIT_GLYPH: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  spades: '♠',
  clubs: '♣',
  hidden: '?',
};

const SUIT_COLOR: Record<string, string> = {
  hearts: 'text-red-600',
  diamonds: 'text-red-600',
  spades: 'text-slate-900',
  clubs: 'text-slate-900',
  hidden: 'text-slate-400',
};

const RANK_LABEL: Record<string, string> = {
  Ace: 'A',
  Jack: 'J',
  Queen: 'Q',
  King: 'K',
  hidden: '',
};

function labelFor(rank: string): string {
  return RANK_LABEL[rank] ?? rank;
}

type PlayingCardProps = {
  card: CardData;
  small?: boolean;
};

export default function PlayingCard({ card, small = false }: PlayingCardProps) {
  const isHidden = card.suit === 'hidden' || card.rank === 'hidden';
  const glyph = SUIT_GLYPH[card.suit] ?? '?';
  const color = SUIT_COLOR[card.suit] ?? 'text-slate-900';
  const rank = labelFor(card.rank);

  // Box, padding, rank label and centre glyph are all sized as a set so
  // the content sums under the box's interior height regardless of
  // variant. Mixing a hard-coded glyph size with a variable box used to
  // overflow the small card.
  const sizing = small
    ? { box: 'w-16 h-24 p-1.5', rank: 'text-sm', glyph: 'text-2xl', backStar: 'text-2xl' }
    : { box: 'w-24 h-32 p-2', rank: 'text-2xl', glyph: 'text-4xl', backStar: 'text-4xl' };

  if (isHidden) {
    return (
      <div
        className={`${sizing.box} rounded-lg border-2 border-slate-300 bg-gradient-to-br from-indigo-700 to-indigo-900 shadow-md flex items-center justify-center`}
        aria-label="hidden card"
      >
        <span className={`text-indigo-300 ${sizing.backStar}`}>★</span>
      </div>
    );
  }

  return (
    <div
      className={`${sizing.box} rounded-lg border border-slate-300 bg-white shadow-md flex flex-col justify-between select-none`}
      aria-label={`${rank} of ${card.suit}`}
    >
      <span className={`${color} ${sizing.rank} font-bold leading-none`}>{rank}</span>
      <span className={`${color} ${sizing.glyph} text-center leading-none`}>{glyph}</span>
      <span className={`${color} ${sizing.rank} font-bold leading-none self-end rotate-180`}>
        {rank}
      </span>
    </div>
  );
}
