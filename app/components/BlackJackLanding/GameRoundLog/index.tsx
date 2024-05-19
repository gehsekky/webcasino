import { GamePlayerDTO } from 'actions/gamePlayer';

type GameRoundLogProps = {
  gamePlayer : GamePlayerDTO;
}

const GameRoundLog = ({ gamePlayer } : GameRoundLogProps) => {
  return (
    <div>
      {
        gamePlayer.game_player_round.map((gamePlayerRound) => {
          return (
            <div key={`${gamePlayerRound.game_player_id}-${gamePlayerRound.round}`}>{gamePlayerRound.round} - {gamePlayerRound.action}</div>
          );
        })
      }
    </div>
  );
}

export default GameRoundLog;
