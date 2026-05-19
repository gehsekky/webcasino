import type { GameDTO } from 'actions/game.server';
import type { GamePlayerDTO } from 'actions/gamePlayer.server';
import BlackJackLanding from 'components/BlackJackLanding';
import Header from 'components/Header';
import { parseBlackjackState } from 'lib/gameState';

type GameLandingProps = {
  game : GameDTO;
  gamePlayer: GamePlayerDTO;
}

const loadGameComponent = (game : GameDTO, gamePlayer : GamePlayerDTO) => {
  const gameData = parseBlackjackState(game.data);
  switch (gameData.type) {
    case 'blackjack':
      return <BlackJackLanding game={game} gamePlayer={gamePlayer} />
    default:
      throw new Error(`unrecognized game type: ${gameData.type}`);
  }
};

const GameLanding = ({ game, gamePlayer } : GameLandingProps) => {
  const gameData = parseBlackjackState(game.data);
  return (
    <>
      <Header title={gameData.type} />
      <div className="container mx-auto">
        <div className="hero min-h-80 bg-base-200">
          <div className="hero-content text-center flex-col">
            {loadGameComponent(game, gamePlayer)}
          </div>
        </div>
      </div>
    </>

  )
};

export default GameLanding;
