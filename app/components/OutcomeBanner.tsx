import { Link } from '@remix-run/react';
import type { PlayerSlot } from 'lib/gameState';

type OutcomeBannerProps = {
  viewerSlot: PlayerSlot;
};

const OUTCOMES: Record<PlayerSlot['status'], { tone: string; title: string; detail: (slot: PlayerSlot) => string }> = {
  won: {
    tone: 'bg-yellow-400 text-slate-900',
    title: 'You won!',
    detail: (s) => `+$${s.bet}`,
  },
  blackjack: {
    tone: 'bg-yellow-400 text-slate-900',
    title: 'Blackjack!',
    detail: (s) => `+$${Math.floor(s.bet * 1.5)}`,
  },
  lost: {
    tone: 'bg-red-700 text-white',
    title: 'You lost',
    detail: (s) => `-$${s.bet}`,
  },
  busted: {
    tone: 'bg-red-700 text-white',
    title: 'Busted',
    detail: (s) => `-$${s.bet}`,
  },
  pushed: {
    tone: 'bg-slate-300 text-slate-900',
    title: 'Push',
    detail: () => 'bet returned',
  },
  surrendered: {
    tone: 'bg-orange-600 text-white',
    title: 'Surrendered',
    detail: (s) => `-$${Math.ceil(s.bet / 2)}`,
  },
  awaiting_bet: { tone: '', title: '', detail: () => '' },
  in_hand: { tone: '', title: '', detail: () => '' },
  stood: { tone: '', title: '', detail: () => '' },
};

export default function OutcomeBanner({ viewerSlot }: OutcomeBannerProps) {
  const config = OUTCOMES[viewerSlot.status];
  if (!config || !config.title) {
    return null;
  }

  return (
    <div className={`rounded-xl px-6 py-5 ${config.tone} text-center shadow-lg`}>
      <p className="text-2xl font-bold uppercase tracking-wide">{config.title}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{config.detail(viewerSlot)}</p>
      <Link
        to="/"
        className="mt-4 inline-block btn btn-neutral text-white font-bold uppercase tracking-wide"
      >
        New Hand
      </Link>
    </div>
  );
}
