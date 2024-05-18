import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const createGamePlayerBet = async (gamePlayerId : string, amount : number, type : string) => {
  const gamePlayerBet = await prisma.$transaction(async (tx) => {
    const gamePlayer = await tx.game_player.findUnique({
      where: {
        id: gamePlayerId,
      },
      include: {
        user: true,
      }
    });

    if (!gamePlayer) {
      throw new Error('could not find game player');
    }

    const user = await tx.user.update({
      where: {
        id: gamePlayer.user_id,
      },
      data: {
        money: gamePlayer.user.money - amount,
      }
    });

    if (!user) {
      throw new Error('could not update user money');
    }

    // await tx.money_transaction.create({
    //   data: {

    //   }
    // })

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
