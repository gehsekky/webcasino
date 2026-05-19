import { Link } from '@remix-run/react';
import type { BlackjackView } from 'engines/blackjack/types';
import { useHandView } from 'hooks/useHandView';
import DealerSection from './DealerSection';
import PlayerSection from './PlayerSection';
import ActionBar from './ActionBar';
import BetForm from './BetForm';
import InsuranceForm from './InsuranceForm';
import OutcomeBanner from './OutcomeBanner';
import ConnectionStatus from './ConnectionStatus';

type AreaInfo = { id: string; name: string } | null;

type HandViewProps = {
  handId: string;
  handSeatId: string;
  initialView: BlackjackView;
  viewerName: string;
  viewerBalance: number;
  /** The casino area this hand belongs to. Null when bet limits don't match any registered area. */
  area: AreaInfo;
  /** The game type ('blackjack' for now). Used by the same-area "New Hand" CTA. */
  gameType: string;
};

export default function HandView({
  handId,
  handSeatId,
  initialView,
  viewerName,
  viewerBalance,
  area,
  gameType,
}: HandViewProps) {
  const { view, status } = useHandView(handId, initialView);
  const viewerSlot = view.players.find((p) => p.id === handSeatId);

  return (
    <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto space-y-4">
        <nav className="px-1">
          <Link
            to={area ? `/casino/${area.id}` : '/'}
            className="inline-flex items-center gap-1 text-sm text-emerald-200 hover:text-white"
          >
            ← Back to {area ? area.name : 'lobby'}
          </Link>
        </nav>
        <div className="flex items-center justify-between gap-3 px-1">
          <PhaseBadge phase={view.phase} />
          <ConnectionStatus status={status} />
        </div>

        <DealerSection cards={view.dealerHand} revealed={view.dealerCardsRevealed} />

        <div className="space-y-3">
          {view.players.map((player) => (
            <PlayerSection
              key={player.id}
              player={player}
              isViewer={player.id === handSeatId}
              isToAct={view.toAct === player.id}
              viewerName={viewerName}
            />
          ))}
        </div>

        <div className="pt-2">
          {view.phase === 'awaiting_bets' && viewerSlot?.status === 'awaiting_bet' && (
            <BetForm
              minimumBet={view.config.minimumBet}
              maximumBet={view.config.maximumBet}
              balance={viewerBalance}
            />
          )}

          {view.phase === 'insurance_offered' && viewerSlot && viewerSlot.insuranceBet === null && (
            <InsuranceForm originalBet={viewerSlot.bet} balance={viewerBalance} />
          )}

          {view.phase === 'insurance_offered' && viewerSlot?.insuranceBet !== null && (
            <p className="text-center text-emerald-200/80 italic">
              waiting for other seats to decide on insurance…
            </p>
          )}

          {view.phase === 'playing' && view.toAct === handSeatId && (
            <ActionBar legalActions={view.legalActions} />
          )}

          {view.phase === 'playing' && view.toAct !== handSeatId && (
            <p className="text-center text-emerald-200/80 italic">
              waiting for another seat to act…
            </p>
          )}

          {view.phase === 'dealer' && (
            <p className="text-center text-emerald-200/80 italic">
              dealer is playing out the hand…
            </p>
          )}

          {view.phase === 'settled' && viewerSlot && (
            <OutcomeBanner viewerSlot={viewerSlot} area={area} gameType={gameType} />
          )}
        </div>
      </div>
    </main>
  );
}

const PHASE_LABEL: Record<BlackjackView['phase'], string> = {
  awaiting_bets: 'Awaiting bets',
  insurance_offered: 'Insurance offered',
  playing: 'In progress',
  dealer: 'Dealer turn',
  settled: 'Hand complete',
};

function PhaseBadge({ phase }: { phase: BlackjackView['phase'] }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wider rounded-full bg-emerald-900/60 px-3 py-1 text-emerald-200 ring-1 ring-emerald-700/60">
      {PHASE_LABEL[phase]}
    </span>
  );
}
