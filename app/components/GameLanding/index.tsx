import BlackJackLanding from "components/BlackJackLanding";
import Header from "components/Header";
import Game from "lib/Game";
import GamePlayer from 'lib/GamePlayer';

type GameLandingProps = {
  game : Game;
  gamePlayer: GamePlayer;
}

const loadGameComponent = (game : Game, gamePlayer : GamePlayer) => {
  switch (game.data.type) {
    case 'blackjack':
      return <BlackJackLanding game={game} gamePlayer={gamePlayer} />
    case 'poker':
      break;
    default:
      throw new Error(`unrecognized game type: ${game.data.type}`);
  }
};

const GameLanding = ({ game, gamePlayer } : GameLandingProps) => {
  return (
    <>
      <Header title={game.type} />
      <div className="container mx-auto">
        <div className="hero min-h-screen bg-base-200">
          <div className="hero-content text-center flex-col">
            
            {loadGameComponent(game, gamePlayer)}
          </div>
        </div>
      </div>
    </>

  )
};

export default GameLanding;
