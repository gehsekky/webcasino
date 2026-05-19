import { Prisma, game_player_bet, game_player_round } from '@prisma/client';
import { getGameById, updateGame } from './game.server';
import Card from 'lib/Card';
import { createMoneyTransaction } from './moneyTransaction.server';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { parseBlackjackState, parseGamePlayerState } from 'lib/gameState';
import { getGamePlayerBetAmount } from 'lib/gamePlayerBet';
export type { GamePlayerData } from 'lib/gameState';
export { getGamePlayerBetAmount };

export type GamePlayerDTO = Prisma.game_playerGetPayload<{ include: { user: true, game_player_bet: true, game_player_round: true }}>;
export type GamePlayerRoundDTO = game_player_round;
export type GamePlayerBetDTO = game_player_bet;

export const getGamePlayerById = async (gamePlayerId : string, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const gameUser = await tx.game_player.findUnique({
    where: {
      id: gamePlayerId,
    },
    include: {
      user: true,
      game_player_bet: true,
      game_player_round: true,
    }
  });

  if (!gameUser) {
    throw new Error(`could not find game player with id = ${gamePlayerId}`);
  }

  return gameUser;
};

export const createGamePlayerRoundForAction = async (gamePlayerDTO : GamePlayerDTO, currentRound : number, action : string, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const gameDTO = await getGameById(gamePlayerDTO.game_id, tx);
  if (!gameDTO) {
    throw new Error('could not get game for player action');
  }
  const gameState = parseBlackjackState(gameDTO.data);
  if (gameState.deck.length === 0) {
    throw new Error('deck is empty');
  }

  if (['hit', 'double down'].indexOf(action) > -1) {
    const popped = gameState.deck.pop();
    if (!popped) {
      throw new Error('could not get popped card');
    }
    const playerData = parseGamePlayerState(gamePlayerDTO.data);
    playerData.cards.push(popped);
    gamePlayerDTO.data = playerData;
    gameDTO.data = gameState;
    await updateGamePlayer(gamePlayerDTO, tx);
    await updateGame(gameDTO, tx);
  }

  const gamePlayerRound = await tx.game_player_round.create({
    data: {
      game_player_id: gamePlayerDTO.id,
      round: currentRound + 1,
      action,
    }
  });

  if (!gamePlayerRound) {
    throw new Error('could not add game player round for hit');
  }

  return gamePlayerRound;
};

export const updateGamePlayer = async (gamePlayer : GamePlayerDTO, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const playerData = parseGamePlayerState(gamePlayer.data);
  const player = await tx.game_player.update({
    where: {
      id: gamePlayer.id,
    },
    data: {
      data: { cards: playerData.cards } as unknown as Prisma.JsonObject
    }
  });

  if (!player) {
    throw new Error('could not update user');
  }

  return getGamePlayerById(player.id, tx);
};

export const submitAction = async (gamePlayerDTO : GamePlayerDTO, currentRound: number, action : string, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const gamePlayerRound = await createGamePlayerRoundForAction(gamePlayerDTO, currentRound, action, tx);
  if (!gamePlayerRound) {
    throw new Error('could not create game player round for action');
  }

  if (['hit', 'double down'].indexOf(action) > -1) {
    // check for bust and add record if necessary
    if (Card.isBust(parseGamePlayerState(gamePlayerDTO.data).cards)) {
      await createGamePlayerRoundForAction(gamePlayerDTO, currentRound + 1, 'lose', tx);
      const bet = getGamePlayerBetAmount(gamePlayerDTO);
      await createMoneyTransaction(gamePlayerDTO.user, 'debit', bet, gamePlayerDTO.id, null, tx);
    } else if (action === 'double down') {
      await createGamePlayerRoundForAction(gamePlayerDTO, currentRound + 1, 'stay', tx);
    }
  } else if (action === 'surrender') {
    await createGamePlayerRoundForAction(gamePlayerDTO, currentRound + 1, 'lose', tx);
    const bet = getGamePlayerBetAmount(gamePlayerDTO);
    await createMoneyTransaction(gamePlayerDTO.user, 'debit', Math.ceil(bet / 2), gamePlayerDTO.id, null, tx);
  }

  return gamePlayerRound;
}

