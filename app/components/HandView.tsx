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
  /** Only the room creator can start the next hand. */
  isRoomCreator: boolean;
  /** Room's current game type — for the between-hands game switcher. */
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';
  /** Room's seat count — gates which games can be switched to. */
  roomMaxSeats: number;
  /**
   * Viewer's hand_seat id if they're a participant in this hand. Null
   * when the viewer joined the room mid-hand and is spectating until the
   * next round.
   */
  handSeatId: string | null;
  initialView: BlackjackView;
  viewerName: string;
  viewerBalance: number;
  /**
   * hand_seat.id → {name, isAi} for each participant in this hand.
   * Split-sibling slots aren't in this map; resolve via parentSlotId.
   */
  participants: Record<string, { name: string; isAi: boolean }>;
};

export default function HandView({
  roomId,
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
  handSeatId,
  initialView,
  viewerName,
  viewerBalance,
  participants,
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
    <main>
      <div className="space-y-4">
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

        <DealerSection cards={view.dealerHand} revealed={view.dealerCardsRevealed} />

        {/* Players: one full-width row per slot. Each row is avatar +
            identity block on the left, cards filling the middle, total
            on the right. Cards wrap inside the row if they outgrow the
            available middle column. */}
        <div className="flex flex-col gap-3">
          {view.players.map((player) => {
            const ownedIdx = viewerSlots.findIndex((s) => s.id === player.id);
            const isViewer = ownedIdx !== -1;
            // For split siblings, the owning hand_seat is the parent.
            const ownerSlotId = player.parentSlotId ?? player.id;
            const owner = participants[ownerSlotId];
            const ownerName = isViewer ? viewerName : (owner?.name ?? player.id.slice(0, 8));
            const ownerIsAi = owner?.isAi ?? false;
            return (
              <PlayerSection
                key={player.id}
                player={player}
                isViewer={isViewer}
                isToAct={view.toAct === player.id}
                ownerName={ownerName}
                ownerIsAi={ownerIsAi}
                turnDeadlineAt={view.turnDeadlineAt}
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

          {view.phase === 'settled' && (
            <OutcomeBanner
              viewerSlots={viewerSlots}
              roomId={roomId}
              isRoomCreator={isRoomCreator}
              roomGameType={roomGameType}
              roomMaxSeats={roomMaxSeats}
            />
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
