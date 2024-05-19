import { ActionFunctionArgs, LoaderFunctionArgs, redirect } from '@remix-run/node';
import { json, useLoaderData } from 'react-router';
import GameLanding from 'components/GameLanding';
import { GameData, GameDTO, getGameById, handlePlayerAction, placeInitialBet, startGame } from 'actions/game';
import { GamePlayerDTO, getGamePlayerById } from 'actions/gamePlayer';

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
  const submitValue = formData.get('submit')?.toString() || '';
  let gamePlayerDTO = await getGamePlayerById(params.gamePlayerId || '');
  // handle placing initial bet
  if (submitValue === 'place initial bet') {
    const amount = parseInt(formData.get('amount')?.toString() || '');
    if (isNaN(amount)) {
      throw new Error('could not parse bet amount');
    }
    await placeInitialBet(gamePlayerDTO, amount);
    // refresh game after bet is made
    gamePlayerDTO = await getGamePlayerById(gamePlayerDTO.id);
    const gameDTO = await getGameById(gamePlayerDTO.game_id);
    if (gameDTO?.game_player.every((gamePlayer) => gamePlayer.game_player_bet.some((playerBet) => playerBet.type === 'initial'))) {
      await startGame(gameDTO);
    }
  } else if (['hit', 'stay', 'surrender', 'double down'].indexOf(submitValue) > -1) {
    await handlePlayerAction(gamePlayerDTO, submitValue);
  }

  return redirect(`/game/${params.gamePlayerId}`);
}

type GameLandingRouteLoaderData = {
  game : GameDTO;
  gamePlayer : GamePlayerDTO;
};

const GameLandingRoute = () => {
  const loaderData = useLoaderData() as GameLandingRouteLoaderData;
  return (
    <GameLanding game={loaderData.game} gamePlayer={loaderData.gamePlayer} />
  );
};

export default GameLandingRoute;
