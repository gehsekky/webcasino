import type { GameData, GameDTO } from 'actions/game';
import { GamePlayerDTO } from 'actions/gamePlayer';
import BlackJackLanding from 'components/BlackJackLanding';
import Header from 'components/Header';

type GameLandingProps = {
  game : GameDTO;
  gamePlayer: GamePlayerDTO;
}

const loadGameComponent = (game : GameDTO, gamePlayer : GamePlayerDTO) => {
  const gameData = game.data as unknown as GameData;
  switch (gameData.type) {
    case 'blackjack':
      return <BlackJackLanding game={game} gamePlayer={gamePlayer} />
    case 'poker':
      break;
    default:
      throw new Error(`unrecognized game type: ${gameData.type}`);
  }
};

const GameLanding = ({ game, gamePlayer } : GameLandingProps) => {
  const gameData = game.data as unknown as GameData;
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
