import { money_transaction, user } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';

export type MoneyTransactionDTO = money_transaction;
export type MoneyTransactionType = 'debit' | 'credit';

export type RecordMoneyTransactionParams = {
  userId: string;
  type: MoneyTransactionType;
  amount: number;
  gamePlayerId?: string | null;
  note?: string | null;
  /**
   * Optional idempotency key. When provided, repeated calls with the same key
   * return the existing row instead of creating a duplicate.
   */
  idempotencyKey?: string | null;
};

/**
 * Records a money movement atomically against the user's balance and the ledger.
 *
 * Concurrency: the balance check + mutation uses a single conditional UPDATE
 * (`UPDATE user SET money = money + delta WHERE id = ? AND money >= minMoney`),
 * which is safe under concurrent execution without explicit row locks.
 *
 * Throws when:
 *  - amount <= 0
 *  - user not found
 *  - debit would drive balance negative
 */
export const recordMoneyTransaction = async (
  params: RecordMoneyTransactionParams,
  tx?: PrismaTransactionClient,
): Promise<MoneyTransactionDTO> => {
  if (!tx) {
    tx = prisma;
  }

  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new Error('money transaction amount must be a positive integer');
  }

  if (params.idempotencyKey) {
    const existing = await tx.money_transaction.findUnique({
      where: { idempotency_key: params.idempotencyKey },
    });
    if (existing) {
      return existing;
    }
  }

  const signedDelta = params.type === 'credit' ? params.amount : -params.amount;
  const minMoneyRequired = params.type === 'debit' ? params.amount : 0;

  const updated = await tx.user.updateMany({
    where: { id: params.userId, money: { gte: minMoneyRequired } },
    data: { money: { increment: signedDelta } },
  });

  if (updated.count === 0) {
    throw new Error('insufficient funds or user not found');
  }

  return tx.money_transaction.create({
    data: {
      user_id: params.userId,
      game_player_id: params.gamePlayerId ?? null,
      type: params.type,
      amount: params.amount,
      note: params.note ?? null,
      idempotency_key: params.idempotencyKey ?? null,
    },
  });
};

/**
 * Returns the current balance for a user. Reads the materialized `user.money`
 * column, which is kept in sync by `recordMoneyTransaction`.
 */
export const getBalance = async (
  userId: string,
  tx?: PrismaTransactionClient,
): Promise<number> => {
  if (!tx) {
    tx = prisma;
  }
  const u = await tx.user.findUnique({ where: { id: userId }, select: { money: true } });
  if (!u) {
    throw new Error(`user ${userId} not found`);
  }
  return u.money;
};

/**
 * @deprecated Use `recordMoneyTransaction({ userId, ... })` directly.
 * Kept temporarily for legacy callers in actions/game.server.ts.
 */
export const createMoneyTransaction = async (
  u: user,
  type: string,
  amount: number,
  gamePlayerId?: string | null,
  note?: string | null,
  tx?: PrismaTransactionClient,
): Promise<MoneyTransactionDTO> => {
  if (type !== 'debit' && type !== 'credit') {
    throw new Error(`unknown money transaction type: ${type}`);
  }
  return recordMoneyTransaction(
    { userId: u.id, type, amount, gamePlayerId, note },
    tx,
  );
};
