import Game from "lib/Game";
import GamePlayer from 'lib/GamePlayer';
import SetWager from './SetWager';
import StartGame from './StartGame';
import PlayerInfo from './PlayerInfo';
import { Form } from '@remix-run/react';
import PlayerOutcome from './PlayerOutcome';
import GameRoundLog from 'components/BlackJackLanding/GameRoundLog';

type BlackJackLandingProps = {
  game: Game;
  gamePlayer: GamePlayer;
};

const BlackJackLanding = ({ game, gamePlayer } : BlackJackLandingProps) => {
  const arePlayersDoneBetting = game.gamePlayers.every((player) => player.gamePlayerBets.some((bet) => bet.type === 'initial'));
  const hasGameStarted = game.data.dealerHand.length > 0;
  const showActionBar = !gamePlayer.gamePlayerRounds.some((round) => ['stay', 'win', 'lose', 'push'].indexOf(round.action) > -1);
  const isGameOver = gamePlayer.gamePlayerRounds.some((round) => ['win', 'lose', 'push'].indexOf(round.action) > -1);
  const playerHighestRound = gamePlayer.gamePlayerRounds[Math.max(...gamePlayer.gamePlayerRounds.map((gamePlayerRound) => gamePlayerRound.round)) - 1];
  const showEndGame = game.gamePlayers.every((player) => player.gamePlayerRounds.some((round) => ['stay', 'win', 'lose', 'push'].indexOf(round.action)));

  if (!gamePlayer.gamePlayerBets || !gamePlayer.gamePlayerBets.length) {
    // if current player has not bet, show set wager screen
    return (
      <SetWager game={game} gamePlayer={gamePlayer} />
    );
  } else if (!arePlayersDoneBetting) {
    // if all players are not done betting, show players not done
    return (
      <>
        <div>players not done betting:</div>
        <ul>
          {game.gamePlayers.filter((gamePlayer) => !gamePlayer.gamePlayerBets.length).map((gamePlayer) => <li>{gamePlayer.user.name}</li>)}
        </ul>
      </>
    );
  } else if (arePlayersDoneBetting && !hasGameStarted) {
    // if players have all set bets but no rounds exist, show start game button to game owner
    return (
      <StartGame game={game} gamePlayer={gamePlayer} />
    );
  } else if (arePlayersDoneBetting && hasGameStarted) {
    // players have bet and game has started. show cards and show player action buttons
    return (
      <>
        <div className="text-left">
          <p className="text-xl">game ID: {game.gameId}</p>
          <p className="text-lg">number of players: {game.gamePlayers.length}</p>
        </div>
        <div className="flex flex-row">
          {
            game.gamePlayers.map((player) => {
              const gamePlayerBet = player.getBetAmount();

              return (
                <PlayerInfo
                  key={player.id}
                  name={player?.user?.name}
                  money={player?.user?.money}
                  currentBet={gamePlayerBet}
                  cards={player.hand}
                  isCurrentPlayer={player.id === gamePlayer.id}
                />
              );
            })
          }
          <PlayerInfo key="dealer" name="dealer" cards={game.data.dealerHand} isCurrentPlayer={false}/>
        </div>
        {
          showActionBar
            ? <Form method="post">
                <div className="">
                  <input type="submit" name="submit" value="hit" className="p-3 m-1 btn border border-solid border-black" />
                  <input type="submit" name="submit" value="stay" className="p-3 m-1 btn border border-solid border-black" />
                  <input type="submit" name="submit" value="surrender" className="p-3 m-1 btn border border-solid border-black" />
                  <input type="submit" name="submit" value="double down" className="p-3 m-1 btn border border-solid border-black" />
                </div>
              </Form>
            : null
        }
        {
          isGameOver
            ? <PlayerOutcome gamePlayerRound={playerHighestRound} />
            : null
        }
        <GameRoundLog gamePlayer={gamePlayer} />
      </>
    );
  } else {
    return (
      <div>unhandled case</div>
    );
  }
};

export default BlackJackLanding;
