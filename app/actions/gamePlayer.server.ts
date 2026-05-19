import { Prisma, hand_seat_bet, hand_seat_round } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from 'db.server';
import { getGamePlayerBetAmount } from 'lib/gamePlayerBet';

export type { GamePlayerData } from 'lib/gameState';
export { getGamePlayerBetAmount };

export type GamePlayerDTO = Prisma.hand_seatGetPayload<{
  include: { user: true, hand_seat_bet: true, hand_seat_round: true };
}>;
export type GamePlayerRoundDTO = hand_seat_round;
export type GamePlayerBetDTO = hand_seat_bet;

export const getGamePlayerById = async (gamePlayerId : string, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const handSeat = await tx.hand_seat.findUnique({
    where: { id: gamePlayerId },
    include: {
      user: true,
      hand_seat_bet: true,
      hand_seat_round: true,
    }
  });

  if (!handSeat) {
    throw new Error(`could not find hand_seat with id = ${gamePlayerId}`);
  }

  return handSeat;
};
