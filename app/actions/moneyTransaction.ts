import { PrismaClient } from '@prisma/client';
import { PrismaTransactionClient } from './game';

const prisma = new PrismaClient();

export const createMoneyTransaction = async (userId : string, gamePlayerId: string, type : string, note : string, tx : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const moneyTransaction = await tx.money_transaction.create({
    data: {
      user_id: userId,
      game_player_id: gamePlayerId,
      type,
      note,
    }
  });
};
