import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const createGamePlayerBet = async (gamePlayerId : string, amount : number, type : string) => {
  const gamePlayerBet = await prisma.$transaction(async (tx) => {
    return await tx.game_player_bet.create({
      data: {
        game_player_id: gamePlayerId,
        amount,
        type,
      }
    });
  });


  if (!gamePlayerBet) {
    throw new Error(`could not create game player bet for gamePlayerId: ${gamePlayerId} with amount: ${amount}`);
  }

  return gamePlayerBet;
};
