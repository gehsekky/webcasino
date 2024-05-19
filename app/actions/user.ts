import { PrismaClient, user } from '@prisma/client';
import { DEFAULT_USER_MONEY } from 'constants/';
import { PrismaTransactionClient } from './game';

const prisma = new PrismaClient();

export const findOrCreateUserByName = async (name : string) => {
  let user = await prisma.user.findUnique({
    where: {
      name,
    }
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        name,
        money: DEFAULT_USER_MONEY,
      }
    })
  }

  if (!user) {
    throw new Error(`could not create or find user with name: ${name}`);
  }

  return user;
};

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

export const updateUser = async (user : user, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const updatedUser = await tx.user.update({
    where: {
      id: user.id,
    },
    data: {
      money: user.money,
    }
  });

  if (!updatedUser) {
    throw new Error('could not update user');
  }

  return updatedUser;
};