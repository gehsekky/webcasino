import { prisma, type PrismaTransactionClient } from 'db.server';

export const createGamePlayerRound = async (gamePlayerId : string, action : string, round: number, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const gamePlayerRound = await tx.game_player_round.create({
    data: {
      game_player_id: gamePlayerId,
      round,
      action,
    }
  });

  if (!gamePlayerRound) {
    throw new Error(`could not create game player round for gamePlayerId: ${gamePlayerId}`);
  }

  return gamePlayerRound;
};
