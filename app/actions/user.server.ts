import { prisma, type PrismaTransactionClient } from 'db.server';

export const getUserById = async (userId : string, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const user = await tx.user.findUnique({
    where: {
      id: userId,
    }
  });

  if (!user) {
    throw new Error('could not find user by id');
  }

  return user;
}