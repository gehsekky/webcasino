import { ActionFunctionArgs, LoaderFunctionArgs, redirect } from '@remix-run/node';
import { json, useLoaderData } from 'react-router';
import GameLanding from 'components/GameLanding';
import { GameDTO, getGameById } from 'actions/game';
import { GamePlayerDTO, getGamePlayerById } from 'actions/gamePlayer';
import Game, { GameData } from 'lib/Game';
import GamePlayer from 'lib/GamePlayer';
import { createGamePlayerBet } from 'actions/gamePlayerBet';

export async function loader({
  params,
} : LoaderFunctionArgs) {
  if (!params.gamePlayerId) {
    throw new Error('no gamePlayerId specified');
  }

  const gamePlayer = await getGamePlayerById(params.gamePlayerId);
  const game = await getGameById(gamePlayer.game_id);

  const gameData = game?.data as unknown as GameData;
  gameData.deck = [];
  if (!gameData.dealerCardsRevealed && gameData.dealerHand.length > 0) {
    gameData.dealerHand[0].suit = 'hidden';
    gameData.dealerHand[0].rank = 'hidden';
  }

  return json({
    game,
    gamePlayer
  });
}

export async function action({
  request,
  params,
} : ActionFunctionArgs) {
  const formData = await request.formData();
  const submitValue = formData.get('submit');
  if (submitValue === 'place initial bet') {
    const amount = parseInt(formData.get('amount')?.toString() || '');
    if (isNaN(amount)) {
      throw new Error('could not parse bet amount');
    }
    const gamePlayerBet = await createGamePlayerBet(params.gamePlayerId || '', amount, 'initial');
    if (!gamePlayerBet) {
      throw new Error('could not create game player bet');
    }
  } else if (submitValue === 'start game') {
    const gamePlayerDTO = await getGamePlayerById(params.gamePlayerId || '');
    const gameDTO = await getGameById(gamePlayerDTO.game_id);
    const game = new Game(gameDTO);
    await game.startGame();
  } else if (submitValue === 'hit' || submitValue === 'stay') {
    console.log('submitValue', submitValue);
    const gamePlayerDTO = await getGamePlayerById(params.gamePlayerId || '');
    const gamePlayer = new GamePlayer(gamePlayerDTO);
    const gameDTO = await getGameById(gamePlayerDTO.game_id);
    const game = new Game(gameDTO);
    await gamePlayer.submitAction(game.data.currentRound, submitValue);
    // check if all players have gone this round
    if (game.gamePlayers.filter((player) => player.active).every((player) => player.gamePlayerRounds.some((round) => round.round === game.data.currentRound))) {
      game.data.currentRound++;
      await game.save();
    }
  }

  return redirect(`/game/${params.gamePlayerId}`);
}

type GameLandingRouteLoaderData = {
  game : GameDTO;
  gamePlayer : GamePlayerDTO;
};

const GameLandingRoute = () => {
  const loaderData = useLoaderData() as GameLandingRouteLoaderData;
  const game = new Game(loaderData.game);
  const gamePlayer = new GamePlayer(loaderData.gamePlayer);
  return (
    <GameLanding game={game} gamePlayer={gamePlayer} />
  );
};

export default GameLandingRoute;
