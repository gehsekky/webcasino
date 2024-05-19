import { Prisma, PrismaClient, game_player_bet, game_player_round } from '@prisma/client';
import { PrismaTransactionClient, getGameById, updateGame } from './game';
import type { GameData } from 'actions/game';
import Card from 'lib/Card';
import { createMoneyTransaction } from './moneyTransaction';

const prisma = new PrismaClient();

export type GamePlayerDTO = Prisma.game_playerGetPayload<{ include: { user: true, game_player_bet: true, game_player_round: true }}>;
export type GamePlayerRoundDTO = game_player_round;
export type GamePlayerBetDTO = game_player_bet;
export type GamePlayerData = {
  cards : Card[];
};

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
  const deck = (gameDTO?.data as unknown as GameData).deck;
  if (!deck) {
    throw new Error('could not get game deck');
  }
  if (deck.length === 0) {
    throw new Error('deck is empty');
  }

  if (['hit', 'double down'].indexOf(action) > -1) {
    const popped = deck.pop();
    if (!popped) {
      throw new Error('could not get popped card');
    }
    (gamePlayerDTO.data as unknown as GamePlayerData).cards.push(popped);
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

  const player = await tx.game_player.update({
    where: {
      id: gamePlayer.id,
    },
    data: {
      data: {
        cards: (gamePlayer.data as unknown as GamePlayerData).cards
      } as unknown as Prisma.JsonObject
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
    if (Card.isBust((gamePlayerDTO.data as unknown as GamePlayerData).cards)) {
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

export const getGamePlayerBetAmount = (gamePlayer : GamePlayerDTO) => {
  if (!gamePlayer.game_player_bet || !gamePlayer.game_player_bet.length) {
    throw new Error('could not access player bets');
  }
  const initialBet = gamePlayer.game_player_bet.find((playerBet) => playerBet.type === 'initial');
  if (!initialBet) {
    throw new Error('could not get initial player bet');
  }
  const isDoubleDown = gamePlayer.game_player_round.some((gamePlayerRound) => gamePlayerRound.action === 'double down');
  let betAmount = initialBet.amount;
  if (isDoubleDown) {
    betAmount += betAmount;
  }
  return betAmount;
}
