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

type HandViewProps = {
  /** Room this hand belongs to. Used for SSE subscription + back link. */
  roomId: string;
  /**
   * Viewer's hand_seat id if they're a participant in this hand. Null
   * when the viewer joined the room mid-hand and is spectating until the
   * next round.
   */
  handSeatId: string | null;
  initialView: BlackjackView;
  viewerName: string;
  viewerBalance: number;
};

export default function HandView({
  roomId,
  handSeatId,
  initialView,
  viewerName,
  viewerBalance,
}: HandViewProps) {
  const { view, status } = useHandView(roomId, initialView);
  // After splitting, the viewer owns multiple slots. The "primary" slot is
  // the one tied to their hand_seat row; siblings are split children.
  // Spectators (handSeatId === null) own no slots.
  const viewerSlots = handSeatId
    ? view.players.filter((p) => p.id === handSeatId || p.parentSlotId === handSeatId)
    : [];
  const primarySlot = viewerSlots.find((s) => s.id === handSeatId);
  const isViewerActing = handSeatId != null && viewerSlots.some((s) => s.id === view.toAct);
  const hasSplit = viewerSlots.length > 1;
  const isSpectator = handSeatId === null;

  return (
    <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="max-w-4xl mx-auto space-y-4">
        <nav className="px-1">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-emerald-200 hover:text-white"
          >
            ← Back to landing
          </Link>
        </nav>
        <div className="flex items-center justify-between gap-3 px-1">
          <PhaseBadge phase={view.phase} />
          <ConnectionStatus status={status} />
        </div>

        <div className="flex justify-center">
          <DealerSection cards={view.dealerHand} revealed={view.dealerCardsRevealed} />
        </div>

        {/* Players seated around the table. Each PlayerSection sizes to
            its own card row; justify-between keeps them spread across
            the parent. Sections wrap to a new row once their combined
            width exceeds the container. */}
        <div className="flex flex-wrap justify-between gap-3">
          {view.players.map((player) => {
            const ownedIdx = viewerSlots.findIndex((s) => s.id === player.id);
            const isViewer = ownedIdx !== -1;
            return (
              <PlayerSection
                key={player.id}
                player={player}
                isViewer={isViewer}
                isToAct={view.toAct === player.id}
                viewerName={viewerName}
                handLabel={isViewer && hasSplit ? `Hand ${ownedIdx + 1}` : undefined}
              />
            );
          })}
        </div>

        <div className="pt-2">
          {isSpectator && view.phase !== 'settled' && (
            <p className="text-center text-emerald-200/80 italic">
              spectating — you join the next hand
            </p>
          )}

          {!isSpectator &&
            view.phase === 'awaiting_bets' &&
            primarySlot?.status === 'awaiting_bet' && (
              <BetForm
                minimumBet={view.config.minimumBet}
                maximumBet={view.config.maximumBet}
                balance={viewerBalance}
              />
            )}

          {!isSpectator &&
            view.phase === 'insurance_offered' &&
            primarySlot &&
            primarySlot.insuranceBet === null && (
              <InsuranceForm originalBet={primarySlot.bet} balance={viewerBalance} />
            )}

          {!isSpectator &&
            view.phase === 'insurance_offered' &&
            primarySlot?.insuranceBet !== null && (
              <p className="text-center text-emerald-200/80 italic">
                waiting for other seats to decide on insurance…
              </p>
            )}

          {!isSpectator && view.phase === 'playing' && isViewerActing && (
            <ActionBar legalActions={view.legalActions} />
          )}

          {!isSpectator && view.phase === 'playing' && !isViewerActing && (
            <p className="text-center text-emerald-200/80 italic">
              waiting for another seat to act…
            </p>
          )}

          {view.phase === 'dealer' && (
            <p className="text-center text-emerald-200/80 italic">
              dealer is playing out the hand…
            </p>
          )}

          {view.phase === 'settled' && <OutcomeBanner viewerSlots={viewerSlots} roomId={roomId} />}
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
