import SetWager from './SetWager';
import PlayerInfo from './PlayerInfo';
import { Form } from '@remix-run/react';
import PlayerOutcome from './PlayerOutcome';
import GameRoundLog from 'components/BlackJackLanding/GameRoundLog';
import type { GameData, GameDTO } from 'actions/game';
import { GamePlayerData, GamePlayerDTO, getGamePlayerBetAmount } from 'actions/gamePlayer';

type BlackJackLandingProps = {
  game: GameDTO;
  gamePlayer: GamePlayerDTO;
};

const BlackJackLanding = ({ game, gamePlayer } : BlackJackLandingProps) => {
  const gameData = game.data as unknown as GameData;
  const arePlayersDoneBetting = game.game_player.every((player) => player.game_player_bet.some((bet) => bet.type === 'initial'));
  const hasGameStarted = gameData.dealerHand.length > 0;
  const showActionBar = !gamePlayer.game_player_round.some((round) => ['stay', 'win', 'lose', 'push'].indexOf(round.action) > -1);
  const isGameOver = gamePlayer.game_player_round.some((round) => ['win', 'lose', 'push'].indexOf(round.action) > -1);
  const playerHighestRound = gamePlayer.game_player_round[Math.max(...gamePlayer.game_player_round.map((gamePlayerRound) => gamePlayerRound.round)) - 1];

  if (!gamePlayer.game_player_bet || !gamePlayer.game_player_bet.length) {
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
          {game.game_player.filter((gamePlayer) => !gamePlayer.game_player_bet.length).map((gamePlayer) => <li>{gamePlayer.user.name}</li>)}
        </ul>
      </>
    );
  } else if (arePlayersDoneBetting && hasGameStarted) {
    // players have bet and game has started. show cards and show player action buttons
    return (
      <>
        <div className="text-left">
          <p className="text-xl">game ID: {game.id}</p>
          <p className="text-lg">number of players: {game.game_player.length}</p>
        </div>
        <div className="flex flex-row">
          {
            game.game_player.map((player) => {
              const playerData = player.data as unknown as GamePlayerData;
              const gamePlayerBet = getGamePlayerBetAmount(player);

              return (
                <PlayerInfo
                  key={player.id}
                  name={player.user.name}
                  money={player.user.money}
                  currentBet={gamePlayerBet}
                  cards={playerData.cards}
                  isCurrentPlayer={player.id === gamePlayer.id}
                />
              );
            })
          }
          <PlayerInfo key="dealer" name="dealer" cards={gameData.dealerHand} isCurrentPlayer={false}/>
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
  }
};

export default BlackJackLanding;
