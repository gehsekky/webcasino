import { Form, Link } from '@remix-run/react';
import type { PlayerSlot } from 'lib/gameState';
import { buttonClass } from 'lib/buttonStyle';

type OutcomeBannerProps = {
  /** One slot per hand owned by the viewer (more than one after a split). */
  viewerSlots: PlayerSlot[];
  /** Area this hand belonged to. Determines where "New Hand" lands. */
  area: { id: string; name: string } | null;
  /** Game type this hand was. Used to start a same-game hand in the same area. */
  gameType: string;
};

type Outcome = { title: string; net: number; reason: string };

function computeOutcome(slot: PlayerSlot): Outcome | null {
  switch (slot.status) {
    case 'won':
      return { title: 'Won', net: slot.bet, reason: 'win' };
    case 'blackjack':
      return { title: 'Blackjack!', net: Math.floor(slot.bet * 1.5), reason: 'blackjack' };
    case 'lost':
      return { title: 'Lost', net: -slot.bet, reason: 'lose' };
    case 'busted':
      return { title: 'Busted', net: -slot.bet, reason: 'bust' };
    case 'pushed':
      return { title: 'Push', net: 0, reason: 'push' };
    case 'surrendered':
      return { title: 'Surrendered', net: -Math.ceil(slot.bet / 2), reason: 'surrender' };
    default:
      return null;
  }
}

function toneFor(net: number): string {
  if (net > 0) return 'bg-yellow-400 text-slate-900';
  if (net < 0) return 'bg-red-700 text-white';
  return 'bg-slate-300 text-slate-900';
}

function netLabel(net: number): string {
  if (net === 0) return 'bet returned';
  return net > 0 ? `+$${net}` : `-$${Math.abs(net)}`;
}

export default function OutcomeBanner({ viewerSlots, area, gameType }: OutcomeBannerProps) {
  const outcomes = viewerSlots
    .map((slot) => ({ slot, outcome: computeOutcome(slot) }))
    .filter((x): x is { slot: PlayerSlot; outcome: Outcome } => x.outcome !== null);

  if (outcomes.length === 0) return null;

  const totalNet = outcomes.reduce((sum, { outcome }) => sum + outcome.net, 0);

  // Single-hand case (no split): show the classic full-banner styling.
  if (outcomes.length === 1) {
    const only = outcomes[0];
    return (
      <BannerShell tone={toneFor(only.outcome.net)} area={area} gameType={gameType}>
        <p className="text-2xl font-bold uppercase tracking-wide">{only.outcome.title}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{netLabel(only.outcome.net)}</p>
      </BannerShell>
    );
  }

  // Split case: per-hand breakdown plus the aggregate.
  return (
    <BannerShell tone={toneFor(totalNet)} area={area} gameType={gameType}>
      <p className="text-xs uppercase tracking-[0.2em] font-semibold opacity-80">Hand results</p>
      <ul className="mt-2 space-y-1 text-sm">
        {outcomes.map(({ slot, outcome }, i) => (
          <li key={slot.id} className="flex items-baseline justify-between">
            <span className="font-semibold">
              Hand {i + 1} · {outcome.title}
            </span>
            <span className="tabular-nums">{netLabel(outcome.net)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-lg font-bold tabular-nums">
        Total: {totalNet === 0 ? 'even' : netLabel(totalNet)}
      </p>
    </BannerShell>
  );
}

function BannerShell({
  tone,
  area,
  gameType,
  children,
}: {
  tone: string;
  area: { id: string; name: string } | null;
  gameType: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl px-6 py-5 ${tone} text-center shadow-lg`}>
      {children}
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
