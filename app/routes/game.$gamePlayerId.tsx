import { ActionFunctionArgs, LoaderFunctionArgs, json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import GameLanding from 'components/GameLanding';
import { GameDTO, getGameById, handlePlayerAction, placeInitialBet, startGame } from 'actions/game.server';
import { GamePlayerDTO, getGamePlayerById } from 'actions/gamePlayer.server';
import { requireSeat } from 'auth/guards.server';
import { parseBlackjackState } from 'lib/gameState';

export async function loader({
  request,
  params,
} : LoaderFunctionArgs) {
  if (!params.gamePlayerId) {
    throw new Error('no gamePlayerId specified');
  }
  await requireSeat(request, params.gamePlayerId);

  const gamePlayer = await getGamePlayerById(params.gamePlayerId);
  const game = await getGameById(gamePlayer.game_id);
  if (!game) {
    throw new Error('game not found');
  }
  const gameState = parseBlackjackState(game.data);
  gameState.deck = [];
  if (!gameState.dealerCardsRevealed && gameState.dealerHand.length > 0) {
    gameState.dealerHand[0].suit = 'hidden';
    gameState.dealerHand[0].rank = 'hidden';
  }
  game.data = gameState;

  return json({
    game,
    gamePlayer
  });
}

export async function action({
  request,
  params,
} : ActionFunctionArgs) {
  if (!params.gamePlayerId) {
    throw new Error('no gamePlayerId specified');
  }
  await requireSeat(request, params.gamePlayerId);

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
  const loaderData = useLoaderData() as unknown as GameLandingRouteLoaderData;
  return (
    <GameLanding game={loaderData.game} gamePlayer={loaderData.gamePlayer} />
  );
};

export default GameLandingRoute;
