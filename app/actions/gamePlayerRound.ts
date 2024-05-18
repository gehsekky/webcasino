import { Prisma, PrismaClient } from '@prisma/client';
import type { GamePlayerRoundData } from 'lib/GamePlayerRound';

const prisma = new PrismaClient();

export const createGamePlayerRound = async (gamePlayerId : string, gamePlayerRoundData : GamePlayerRoundData, round: number) => {
  const gamePlayerRound = await prisma.game_player_round.create({
    data: {
      game_player_id: gamePlayerId,
      data: gamePlayerRoundData as unknown as Prisma.JsonObject,
      round,
    }
  });

  if (!gamePlayerRound) {
    throw new Error(`could not create game player round for gamePlayerId: ${gamePlayerId}`);
  }

  return gamePlayerRound;
};
