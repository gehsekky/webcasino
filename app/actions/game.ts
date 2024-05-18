import { Prisma, PrismaClient, game } from '@prisma/client';
import User from 'lib/User';
import type { GameData } from 'lib/Game';
import { DEFAULT_MAXIMUM_BET, DEFAULT_MINIMUM_BET } from 'constants/';
import Deck from 'lib/Deck';
import { getGamePlayerById } from './gamePlayer';
import Game from 'lib/Game';

const prisma = new PrismaClient();
export type PrismaTransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export const createNewGameAndGamePlayer = async (type : string, createdBy : User) => {
  const newDeck = new Deck();
  const gameData : GameData = {
    type,
    minimumBet: DEFAULT_MINIMUM_BET,
    maximumBet: DEFAULT_MAXIMUM_BET,
    deck: newDeck.cards,
    currentRound: 0,
    dealerHand: [],
    dealerCardsRevealed: false,
  };

  const { hydratedNewGame, newGamePlayer } = await prisma.$transaction(async (tx) => {
    const newGame = await tx.game.create({
      data: {
        created_by: createdBy.id,
        data: gameData as unknown as Prisma.JsonObject,
      }
    });
  
    if (!newGame) {
      throw new Error('could not create new game');
    }
  
    const newGamePlayer = await tx.game_player.create({
      data: {
        user_id: createdBy.id,
        game_id: newGame.id,
      }
    });
  
    if (!newGamePlayer) {
      throw new Error('could not create new game player');
    }

    const hydratedNewGame = await getGameById(newGame.id, tx);

    return {
      hydratedNewGame,
      newGamePlayer,
    };
  });

  
  const hydratedNewGamePlayer = await getGamePlayerById(newGamePlayer.id);

  return {
    game: hydratedNewGame,
    gamePlayer: hydratedNewGamePlayer
  };
};

export type GameDTO = Prisma.gameGetPayload<{ include: { game_player: { include: { user: true, game_player_bet: true, game_player_round: true }}}}>;

export const getGameById = async (gameId : string, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const game = await tx.game.findUnique({
    where: {
      id: gameId,
    },
    include: {
      game_player: {
        include: {
          user: true,
          game_player_bet: true,
          game_player_round: true,
        }
      },
    }
  });

  return game;
};

export const updateGame = async (game : Game) => {
  return prisma.$transaction(async (tx) => {
    return tx.game.update({
      where: {
        id: game.gameId,
      },
      data: {
        data: game.data as unknown as Prisma.JsonObject,
        updated_at: new Date().toISOString(),
      }
    })
  });
};
