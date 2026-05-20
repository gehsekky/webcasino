import { Form, Link } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import type { FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';
import { CATEGORY_LABEL } from 'engines/poker/shared/types';
import { buttonClass } from 'lib/buttonStyle';
import GameSwitcher from './GameSwitcher';

type PokerOutcomeBannerProps = {
  view: FiveCardDrawView;
  handSeatId: string;
  /** Room this hand was at. "Start Next Hand" posts back here to start the next one. */
  roomId: string;
  /** Only the room creator can advance to the next hand. */
  isRoomCreator: boolean;
  /** Current game at the room — feeds the between-hands switcher. */
  roomGameType: 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';
  /** Room's seat count — gates the switcher's available options. */
  roomMaxSeats: number;
};

export default function PokerOutcomeBanner({
  view,
  handSeatId,
  roomId,
  isRoomCreator,
  roomGameType,
  roomMaxSeats,
}: PokerOutcomeBannerProps) {
  if (view.phase !== 'settled') return null;

  const viewer = view.players.find((p) => p.id === handSeatId);
  const winners = view.players.filter((p) => p.winnings > 0);

  const viewerWon = viewer ? viewer.winnings > 0 : false;
  const viewerNet = viewer ? viewer.winnings - viewer.totalBet : 0;

  return (
    <div
      className={`rounded-xl px-6 py-5 ${viewerWon ? 'bg-yellow-400 text-slate-900' : 'bg-slate-800 text-white'} text-center shadow-lg`}
    >
      {viewerWon ? (
        <>
          <p className="text-2xl font-bold uppercase tracking-wide">You won!</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">+${viewerNet.toLocaleString()}</p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold uppercase tracking-wide">Hand over</p>
          {viewer && viewer.totalBet > 0 && (
            <p className="mt-1 text-lg tabular-nums text-red-300">
              −${viewer.totalBet.toLocaleString()}
            </p>
          )}
        </>
      )}

      <div className="mt-3 text-sm space-y-1">
        {winners.map((w) => (
          <p key={w.id} className="opacity-90">
            {w.id === handSeatId ? 'You' : w.id.slice(0, 8)} took{' '}
            <span className="font-bold tabular-nums">${w.winnings.toLocaleString()}</span>
            {w.rank && <span className="opacity-75"> · {CATEGORY_LABEL[w.rank.category]}</span>}
          </p>
        ))}
      </div>

      <div className="mt-4 flex flex-col items-center gap-3">
        <GameSwitcher
          roomId={roomId}
          currentGame={roomGameType}
          maxSeats={roomMaxSeats}
          isRoomCreator={isRoomCreator}
        />
        {isRoomCreator ? (
          <Form method="post" action={`/rooms/${roomId}`} className="inline-block">
            <AuthenticityTokenInput />
            <input type="hidden" name="intent" value="start_hand" />
            <button type="submit" className={buttonClass({ variant: 'primary' })}>
              Start Next Hand
            </button>
          </Form>
        ) : (
          <p className="text-sm italic opacity-80">
            waiting for the room creator to start the next hand…
          </p>
        )}
        <Link to="/" className={buttonClass({ variant: 'neutral' })}>
          Landing
        </Link>
      </div>
    </div>
  );
}
