import { Prisma, PrismaClient, game_player_bet, game_player_round } from '@prisma/client';
import GamePlayer from 'lib/GamePlayer';
import { getGameById } from './game';
import Game, { GameData } from 'lib/Game';
import Card from 'lib/Card';

const prisma = new PrismaClient();

export type GamePlayerDTO = Prisma.game_playerGetPayload<{ include: { user: true, game_player_bet: true, game_player_round: true }}>;
export type GamePlayerRoundDTO = game_player_round;
export type GamePlayerBetDTO = game_player_bet;

export const getGamePlayerById = async (gamePlayerId : string) => {
  const gameUser = await prisma.$transaction(async (tx) => {
    return tx.game_player.findUnique({
      where: {
        id: gamePlayerId,
      },
      include: {
        user: true,
        game_player_bet: true,
        game_player_round: true,
      }
    });
  });

  if (!gameUser) {
    throw new Error(`could not find game player with id = ${gamePlayerId}`);
  }

  return gameUser;
};

export const createGamePlayerRoundForAction = async (gamePlayer : GamePlayer, currentRound : number, action : string) => {
  const gamePlayerRound = await prisma.$transaction(async (tx) => {
    const gameDTO = await getGameById(gamePlayer.gameId, tx);
    const deck = (gameDTO?.data as unknown as GameData).deck;
    if (!deck) {
      throw new Error('could not get game deck');
    }
    if (deck.length === 0) {
      throw new Error('deck is empty');
    }

    if (action === 'hit') {
      const popped = deck.pop();
      if (!popped) {
        throw new Error('could not get popped card');
      }
      gamePlayer.hand.push(popped);
      await gamePlayer.save();
      const game = new Game(gameDTO);
      await game.save();
    }

    return tx.game_player_round.create({
      data: {
        game_player_id: gamePlayer.id,
        round: currentRound + 1,
        action,
      }
    });
  });

  if (!gamePlayerRound) {
    throw new Error('could not add game player round for hit');
  }

  return gamePlayerRound;
};

export const updateGamePlayer = async (gamePlayer : GamePlayer) => {
  const player = await prisma.$transaction(async (tx) => {
    return tx.game_player.update({
      where: {
        id: gamePlayer.id,
      },
      data: {
        data: {
          cards: gamePlayer.hand
        } as unknown as Prisma.JsonObject
      }
    })
  });

  if (!player) {
    throw new Error('could not update user');
  }

  return player;
};
