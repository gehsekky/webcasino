import { Form, Link } from '@remix-run/react';
import type { PlayerSlot } from 'lib/gameState';
import { buttonClass } from 'lib/buttonStyle';

type OutcomeBannerProps = {
  viewerSlot: PlayerSlot;
  /** Area this hand belonged to. Determines where "New Hand" lands. */
  area: { id: string; name: string } | null;
  /** Game type this hand was. Used to start a same-game hand in the same area. */
  gameType: string;
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

export default function OutcomeBanner({ viewerSlot, area, gameType }: OutcomeBannerProps) {
  const config = OUTCOMES[viewerSlot.status];
  if (!config || !config.title) {
    return null;
  }

  return (
    <div className={`rounded-xl px-6 py-5 ${config.tone} text-center shadow-lg`}>
      <p className="text-2xl font-bold uppercase tracking-wide">{config.title}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{config.detail(viewerSlot)}</p>

      {area ? (
        <Form method="post" action={`/casino/${area.id}`} className="mt-4 inline-block">
          <input type="hidden" name="game" value={gameType} />
          <button type="submit" className={buttonClass({ variant: 'neutral' })}>
            New Hand
          </button>
        </Form>
      ) : (
        <Link to="/" className={buttonClass({ variant: 'neutral', className: 'mt-4' })}>
          New Hand
        </Link>
      )}
    </div>
  );
}
