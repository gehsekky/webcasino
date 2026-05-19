import { ActionFunctionArgs, LoaderFunctionArgs, json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import GameLanding from 'components/GameLanding';
import { GameDTO, getGameById } from 'actions/game.server';
import { GamePlayerDTO, getGamePlayerById } from 'actions/gamePlayer.server';
import { submitAction, parseBlackjackActionFromForm } from 'actions/handEngine.server';
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
  const game = await getGameById(gamePlayer.hand_id);
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
  const action = parseBlackjackActionFromForm(submitValue, formData, params.gamePlayerId);
  await submitAction({ handSeatId: params.gamePlayerId, action });

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
