import { Form } from '@remix-run/react';
import type { FiveCardDrawView } from 'engines/poker/fiveCardDraw/types';
import { CATEGORY_LABEL } from 'engines/poker/shared/types';
import { buttonClass } from 'lib/buttonStyle';

type PokerOutcomeBannerProps = {
  view: FiveCardDrawView;
  handSeatId: string;
  area: { id: string; name: string } | null;
};

export default function PokerOutcomeBanner({
  view,
  handSeatId,
  area,
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
            {w.id === handSeatId ? 'You' : w.id.slice(0, 8)}{' '}
            took{' '}
            <span className="font-bold tabular-nums">${w.winnings.toLocaleString()}</span>
            {w.rank && (
              <span className="opacity-75"> · {CATEGORY_LABEL[w.rank.category]}</span>
            )}
          </p>
        ))}
      </div>

      {area ? (
        <Form method="post" action={`/casino/${area.id}`} className="mt-4 inline-block">
          <input type="hidden" name="game" value="poker" />
          <button type="submit" className={buttonClass({ variant: 'neutral' })}>
            New Hand
          </button>
        </Form>
      ) : (
        <Form method="post" action="/" className="mt-4 inline-block">
          <button type="submit" className={buttonClass({ variant: 'neutral' })}>
            Lobby
          </button>
        </Form>
      )}
    </div>
  );
}
