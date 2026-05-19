import { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';

export type { PrismaTransactionClient };
export type { GameData } from 'lib/gameState';

// A "GameDTO" is a hand row with its seats hydrated for the read path.
// Named `GameDTO` for historical compat; semantically this is "one hand of
// play." All state transitions go through `actions/handEngine.server.ts`.
export type GameDTO = Prisma.handGetPayload<{
  include: { hand_seat: { include: { user: true, hand_seat_bet: true, hand_seat_round: true } } };
}>;

export const getGameById = async (gameId : string, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  return tx.hand.findUnique({
    where: { id: gameId },
    include: {
      hand_seat: {
        include: {
          user: true,
          hand_seat_bet: true,
          hand_seat_round: true,
        }
      },
    }
  });
};
