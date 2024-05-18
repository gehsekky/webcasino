import { PrismaClient, money_transaction } from '@prisma/client';
import { PrismaTransactionClient } from './game';

const prisma = new PrismaClient();

export type MoneyTransactionDTO = money_transaction;

export const createMoneyTransaction = async (userId : string, type : string, amount : number, gamePlayerId? : string | null, note? : string | null, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const moneyTransaction = await tx.money_transaction.create({
    data: {
      user_id: userId,
      game_player_id: gamePlayerId,
      type,
      amount,
      note,
    }
  });

  if (!moneyTransaction) {
    throw new Error('could not create new money transaction');
  }

  return moneyTransaction;
};
