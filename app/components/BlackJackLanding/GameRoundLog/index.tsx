import GamePlayer from 'lib/GamePlayer';

type GameRoundLogProps = {
  gamePlayer : GamePlayer;
}

const GameRoundLog = ({ gamePlayer } : GameRoundLogProps) => {
  return (
    <div>
      {
        gamePlayer.gamePlayerRounds.map((gamePlayerRound) => {
          return (
            <div>
              <div>{gamePlayerRound.round} - {gamePlayerRound.action}</div>
            </div>
          );
        })
      }
    </div>
  );
}

export default GameRoundLog;
