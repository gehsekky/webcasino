import Game from "lib/Game";
import GamePlayer from 'lib/GamePlayer';
import SetWager from './SetWager';
import StartGame from './StartGame';
import PlayerInfo from './PlayerInfo';
import { Form } from '@remix-run/react';

type BlackJackLandingProps = {
  game: Game;
  gamePlayer: GamePlayer;
};

const BlackJackLanding = ({ game, gamePlayer } : BlackJackLandingProps) => {
  const arePlayersDoneBetting = game.gamePlayers.every((player) => player.gamePlayerBets.some((bet) => bet.type === 'initial'));
  const doesGameHaveRounds = game.data.currentRound > 0;
  const playerHighestRound = Math.max(...gamePlayer.gamePlayerRounds.map((gamePlayerRound) => gamePlayerRound.round));

  if (!gamePlayer.active) {
    // TODO if game player is not active, show spectating screen
    throw new Error('game player not active');
  } else if (gamePlayer.gamePlayerBets.length === 0) {
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
          {game.gamePlayers.filter((gamePlayer) => gamePlayer.gamePlayerBets.length === 0).map((gamePlayer) => <li>{gamePlayer.user.name}</li>)}
        </ul>
      </>
    );
  } else if (arePlayersDoneBetting && !doesGameHaveRounds) {
    // if players have all set bets but no rounds exist, show start game button to game owner
    return (
      <StartGame game={game} gamePlayer={gamePlayer} />
    );
  } else if (arePlayersDoneBetting && doesGameHaveRounds) {
    // players have bet and game has started. show cards and show player action buttons
    return (
      <>
        <div>gameId: {game.gameId}</div>
        <div>number of player: {game.gamePlayers.length}</div>
        <div>current round: {game.data.currentRound}</div>
        <div className="flex flex-row">
          {
            game.gamePlayers.map((player) => {
              const gamePlayerBet = player.gamePlayerBets.find((gamePlayerBet) => {
                return gamePlayerBet.type === 'initial';
              });

              const highestRound = Math.max(...player.gamePlayerRounds.map((gamePlayerRound) => gamePlayerRound.round));
              const cards = player.gamePlayerRounds.find((gamePlayerRound) => gamePlayerRound.round === highestRound)?.data?.hand;
              if (!cards) {
                throw new Error(`could not get cards for gamePlayerId: ${player.id} for round: ${game.data.currentRound}`);
              }

              return (
                <PlayerInfo
                  key={player.id}
                  name={player?.user?.name}
                  money={player?.user?.money}
                  currentBet={gamePlayerBet?.amount}
                  cards={cards}
                  isCurrentPlayer={player.id === gamePlayer.id} 
                />
              );
            })
          }
          <PlayerInfo key="dealer" name="dealer" cards={game.data.dealerHand} isCurrentPlayer={false}/>
        </div>
        {
          playerHighestRound === game.data.currentRound ?
            <Form method="post">
              <div className="">
                <input type="submit" name="submit" value="hit" className="p-3 m-1 btn border border-solid border-black" />
                <input type="submit" name="submit" value="stay" className="p-3 m-1 btn border border-solid border-black" />
              </div>
            </Form> :
            <div>waiting on other players to finish this turn</div>
        }

      </>
    );
  } else {
    return (
      <div>unhandled case</div>
    );
  }
};

export default BlackJackLanding;
