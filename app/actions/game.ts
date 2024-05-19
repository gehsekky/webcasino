import { Prisma, PrismaClient, user } from '@prisma/client';
import { DEFAULT_MAXIMUM_BET, DEFAULT_MINIMUM_BET } from 'constants/';
import Deck from 'lib/Deck';
import { GamePlayerDTO, GamePlayerData, getGamePlayerBetAmount, getGamePlayerById, submitAction, updateGamePlayer } from './gamePlayer';
import Card from 'lib/Card';
import { createGamePlayerBet } from './gamePlayerBet';
import { createMoneyTransaction } from './moneyTransaction';
import { createGamePlayerRound } from './gamePlayerRound';

const prisma = new PrismaClient();
export type PrismaTransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
export type GameDTO = Prisma.gameGetPayload<{ include: { game_player: { include: { user: true, game_player_bet: true, game_player_round: true }}}}>;
export type GameData = {
  type: string;
  minimumBet: number;
  maximumBet: number;
  deck: Card[];
  dealerHand: Card[],
  dealerCardsRevealed : boolean,
}

export const createNewGameAndGamePlayer = async (type : string, createdBy : user) => {
  const newDeck = new Deck();
  const gameData : GameData = {
    type,
    minimumBet: DEFAULT_MINIMUM_BET,
    maximumBet: DEFAULT_MAXIMUM_BET,
    deck: newDeck.cards,
    dealerHand: [],
    dealerCardsRevealed: false,
  };

  const { hydratedNewGame, hydratedNewGamePlayer } = await prisma.$transaction(async (tx) => {
    const newGame = await tx.game.create({
      data: {
        created_by: createdBy.id,
        data: gameData as unknown as Prisma.JsonObject,
      }
    });
  
    if (!newGame) {
      throw new Error('could not create new game');
    }
  
    const newGamePlayer = await tx.game_player.create({
      data: {
        user_id: createdBy.id,
        game_id: newGame.id,
        data: {
          cards: [],
        }
      }
    });
  
    if (!newGamePlayer) {
      throw new Error('could not create new game player');
    }

    const hydratedNewGame = await getGameById(newGame.id, tx);
    const hydratedNewGamePlayer = await getGamePlayerById(newGamePlayer.id, tx);

    return {
      hydratedNewGame,
      hydratedNewGamePlayer,
    };
  });

  return {
    game: hydratedNewGame,
    gamePlayer: hydratedNewGamePlayer
  };
};

export const getGameById = async (gameId : string, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const game = await tx.game.findUnique({
    where: {
      id: gameId,
    },
    include: {
      game_player: {
        include: {
          user: true,
          game_player_bet: true,
          game_player_round: true,
        }
      },
    }
  });

  return game;
};

export const updateGame = async (game : GameDTO | null, tx : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  const updatedGame = await tx.game.update({
    where: {
      id: game?.id,
    },
    data: {
      data: game?.data as unknown as Prisma.JsonObject,
      updated_at: new Date().toISOString(),
    }
  });

  if (!updatedGame) {
    throw new Error('could not update game');
  }

  return await getGameById(updatedGame.id, tx);
};

export const dealToDealer = async (game : GameDTO | null, tx : PrismaTransactionClient) => {
  const hand : Card[] = [];
  const gameData = game?.data as unknown as GameData;
  if (gameData.deck.length < 2) {
    throw new Error('not enough cards in deck to deal to dealer');
  }
  for (let i = 0; i < 2; i++) {
    const popped = gameData.deck.pop();
    if (!popped) {
      throw new Error('could not fetch card from deck for dealer');
    }
    hand.push(popped);
  }

  gameData.dealerHand = hand;
  await updateGame(game, tx);
}

export const dealToPlayer = async (game : GameDTO | null, gamePlayer : GamePlayerDTO, round : number, tx : PrismaTransactionClient) => {
  const hand = [];
  const gameData = game?.data as unknown as GameData;
  if (gameData.deck.length < 2) {
    throw new Error('not enough cards in deck to deal to player');
  }
  for (let i = 0; i < 2; i++) {
    const popped =gameData.deck.pop();
    if (!popped) {
      throw new Error('could not fetch card from deck for player');
    }
    hand.push(popped);
  }
  (gamePlayer.data as unknown as GamePlayerData).cards = hand;
  await updateGamePlayer(gamePlayer, tx);

  const gamePlayerRound = await createGamePlayerRound(gamePlayer.id, 'deal', round, tx);
  if (!gamePlayerRound) {
    throw new Error(`could not create game player round for gamePlayerId: ${gamePlayer.id}`);
  }

  await updateGame(game, tx);
}

export const startGame = async (game : GameDTO | null) => {
  await prisma.$transaction(async (tx) => {
    // deal cards
    game?.game_player.forEach(async (game_player) => {
      await dealToPlayer(game, game_player, 1, tx);
    });

    // deal to dealer
    await dealToDealer(game, tx);

    game = await getGameById(game?.id || '');
    const gameData = game?.data as unknown as GameData;
    // check if dealer has 21
    if (Card.has21(gameData.dealerHand) && game?.game_player) {
      for (const game_player of game?.game_player) {
        const total = Card.getTotal((game_player.data as unknown as GamePlayerData).cards);
        const bet = getGamePlayerBetAmount(game_player);
        if (total === 21) {
          // player push
          await submitAction(game_player, 1, 'push', tx);
        } else {
          // lose (money is already debit on bet so we don't need to update)
          await submitAction(game_player, 1, 'lose', tx);
          // debit money from user
          await createMoneyTransaction(game_player.user, 'debit', bet, game_player.id, null, tx);
        }
      }
      gameData.dealerCardsRevealed = true;
      game = await updateGame(game, tx);
    } else {
      if (game?.game_player) {
        for (const game_player of game?.game_player) {
          const gamePlayerData = game_player.data as unknown as GamePlayerData;
          const total = Card.getTotal(gamePlayerData.cards);
          const bet = getGamePlayerBetAmount(game_player);
          if (total === 21) {
            // player win
            await submitAction(game_player, 1, 'win', tx);
            // award user
            await createMoneyTransaction(game_player.user, 'credit', Math.floor(bet * 1.5), game_player.id, null, tx);
          }
        }
      }
    }
  });
}

export const endGame = async (game : GameDTO | null) => {
  await prisma.$transaction(async (tx) => {
    const gameData = game?.data as unknown as GameData;
    gameData.dealerCardsRevealed = true;
    let stop = false;
    let sum = Card.getTotal(gameData.dealerHand);
    while (!stop && sum < 17) {
      const popped = gameData.deck.pop();
      if (!popped) {
        throw new Error('could not fetch card from deck for dealer');
      }
      gameData.dealerHand.push(popped);
      sum = Card.getTotal(gameData.dealerHand);
  
      if (sum > 17) {
        stop = true;
      }
    }
  
    if (game?.game_player) {
      // check for bust. if yes, everyone under 21 wins
      for (const game_player of game?.game_player) {
        // get highest round
        const gamePlayerData = game_player.data as unknown as GamePlayerData;
        const maxRound = Math.max(...game_player.game_player_round.map((round) => round.round));
        const lastRound = game_player.game_player_round.find((round) => round.round === maxRound);
        if (!lastRound) {
          throw new Error('could not get last round for player');
        }
        const playerTotal = Card.getTotal(gamePlayerData.cards);
        // if still in game, add win round
        if (['win', 'lose', 'push'].indexOf(lastRound.action) === -1) {
          let gamePlayerRound;
          if (sum > 21 || sum < playerTotal) {
            gamePlayerRound = await submitAction(game_player, lastRound.round, 'win', tx);
            await createMoneyTransaction(game_player.user, 'credit', getGamePlayerBetAmount(game_player), game_player.id, null, tx);
          } else if (sum > playerTotal) {
            gamePlayerRound = await submitAction(game_player, lastRound.round, 'lose', tx);
            await createMoneyTransaction(game_player.user, 'debit', getGamePlayerBetAmount(game_player), game_player.id, null, tx);
          } else {
            gamePlayerRound = await submitAction(game_player, lastRound.round, 'push', tx);
          }
          if (!gamePlayerRound) {
            throw new Error('could not create ending game player round');
          }
        }
      }
    }

    await updateGame(game, tx);
  });
}

export const placeInitialBet = async (gamePlayer : GamePlayerDTO, amount : number, tx? : PrismaTransactionClient) => {
  if (!tx) {
    tx = prisma;
  }

  // handle placing initial bet
  const gamePlayerBet = await createGamePlayerBet(gamePlayer.id, amount, 'initial', tx);
  if (!gamePlayerBet) {
    throw new Error('could not create game player bet');
  }
};

export const handlePlayerAction = async (gamePlayer : GamePlayerDTO, action : string) => {
  const game = await prisma.$transaction(async (tx) => {
    // handle player actions
    const playerHighestRound = Math.max(...gamePlayer.game_player_round.map((gamePlayerRound) => gamePlayerRound.round));
    await submitAction(gamePlayer, playerHighestRound, action, tx);
    return await getGameById(gamePlayer.game_id, tx);
  });

  // check if every user is at stay or is out of game
  if (game?.game_player.every((player) => player.game_player_round.some((round) => ['stay', 'win', 'lose', 'push'].indexOf(round.action) > -1))) {
    // check if at least one player is left to continue
    if (game.game_player.some((player) => player.game_player_round.some((round) => ['stay'].indexOf(round.action) > -1))) {
      await endGame(game);
    }
  }
};
