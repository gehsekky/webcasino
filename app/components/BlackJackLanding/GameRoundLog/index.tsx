import type { GamePlayerDTO } from 'actions/gamePlayer.server';

type GameRoundLogProps = {
  gamePlayer : GamePlayerDTO;
}

const GameRoundLog = ({ gamePlayer } : GameRoundLogProps) => {
  return (
    <div>
      {
        gamePlayer.hand_seat_round.map((gamePlayerRound) => {
          return (
            <div key={`${gamePlayerRound.hand_seat_id}-${gamePlayerRound.round}`}>{gamePlayerRound.round} - {gamePlayerRound.action}</div>
          );
        })
      }
    </div>
  );
}

export default GameRoundLog;
