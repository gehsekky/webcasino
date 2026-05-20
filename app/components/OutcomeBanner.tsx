import { Form, Link } from '@remix-run/react';
import type { PlayerSlot } from 'lib/gameState';
import { buttonClass } from 'lib/buttonStyle';

type OutcomeBannerProps = {
  /** One slot per hand owned by the viewer (more than one after a split). Empty for spectators. */
  viewerSlots: PlayerSlot[];
  /** Room this hand was at. "New Hand" posts back here to start the next one. */
  roomId: string;
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

export default function OutcomeBanner({ viewerSlots, roomId }: OutcomeBannerProps) {
  const outcomes = viewerSlots
    .map((slot) => ({ slot, outcome: computeOutcome(slot) }))
    .filter((x): x is { slot: PlayerSlot; outcome: Outcome } => x.outcome !== null);

  // Spectator (or anomalous empty outcomes): show a neutral banner with
  // just the "next hand" affordance — they didn't have a stake.
  if (outcomes.length === 0) {
    return (
      <BannerShell tone="bg-slate-700 text-white" roomId={roomId}>
        <p className="text-lg font-semibold uppercase tracking-wide">Hand over</p>
      </BannerShell>
    );
  }

  const totalNet = outcomes.reduce((sum, { outcome }) => sum + outcome.net, 0);

  if (outcomes.length === 1) {
    const only = outcomes[0];
    return (
      <BannerShell tone={toneFor(only.outcome.net)} roomId={roomId}>
        <p className="text-2xl font-bold uppercase tracking-wide">{only.outcome.title}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{netLabel(only.outcome.net)}</p>
      </BannerShell>
    );
  }

  return (
    <BannerShell tone={toneFor(totalNet)} roomId={roomId}>
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
  roomId,
  children,
}: {
  tone: string;
  roomId: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl px-6 py-5 ${tone} text-center shadow-lg`}>
      {children}
      <div className="mt-4 flex justify-center gap-3">
        <Form method="post" action={`/rooms/${roomId}`} className="inline-block">
          <input type="hidden" name="intent" value="start_hand" />
          <button type="submit" className={buttonClass({ variant: 'neutral' })}>
            New Hand
          </button>
        </Form>
        <Link to="/" className={buttonClass({ variant: 'neutral' })}>
          Landing
        </Link>
      </div>
    </div>
  );
}
