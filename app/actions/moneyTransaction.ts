import { PrismaClient, money_transaction, user } from '@prisma/client';
import { PrismaTransactionClient } from './game';
import { updateUser } from './user';

const prisma = new PrismaClient();

export type MoneyTransactionDTO = money_transaction;

export const createMoneyTransaction = async (user : user, type : string, amount : number, gamePlayerId? : string | null, note? : string | null, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  if (type === 'debit') {
    user.money -= amount;
  } else if (type === 'credit') {
    user.money += amount;
  } else {
    throw new Error('unknown money transaction type');
  }
  await updateUser(user, tx);

  const moneyTransaction = await tx.money_transaction.create({
    data: {
      user_id: user.id,
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
