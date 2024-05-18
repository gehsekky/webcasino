import { PrismaClient } from '@prisma/client';
import { DEFAULT_USER_MONEY } from 'constants/';

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
