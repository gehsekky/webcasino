import { GameDTO, updateGame } from 'actions/game';
import { createGamePlayerRound } from 'actions/gamePlayerRound';
import { getUserById } from 'actions/user';
import Card from 'lib/Card';
import Deck from 'lib/Deck';
import GamePlayer from 'lib/GamePlayer';
import MoneyManager from 'lib/MoneyManager';
import User from 'lib/User';

export interface GameData {
  type: string;
  minimumBet: number;
  maximumBet: number;
  deck: Card[];
  dealerHand: Card[],
  dealerCardsRevealed : boolean,
}

class Game {
  gameId: string;
  createdBy: string;
  type: string;
  gamePlayers: GamePlayer[];
  data: GameData;
  deck: Deck;

  constructor(gameDTO : GameDTO | null) {
    if (gameDTO === null) {
      throw new Error('gameDTO null');
    }
    this.gameId = gameDTO.id;
    this.createdBy = gameDTO.created_by
    this.data = gameDTO.data as unknown as GameData;
    this.type = this.data.type;
    this.gamePlayers = gameDTO.game_player.map((gamePlayer) => {
      return new GamePlayer(gamePlayer);
    });
    this.deck = Deck.createNewDeckFromCards(this.data.deck);
  }

  async startGame() {
    // deal cards
    this.gamePlayers.forEach(async (gamePlayer) => {
      await this.dealToPlayer(gamePlayer, 1);
    });

    // deal to dealer
    await this.dealToDealer();

    // check if dealer has 21
    if (Card.has21(this.data.dealerHand)) {
      for (const gamePlayer of this.gamePlayers) {
        const total = Card.getTotal(gamePlayer.hand);
        const bet = gamePlayer.getBetAmount();
        if (total === 21) {
          // player push
          await gamePlayer.submitAction(1, 'push');
        } else {
          // lose (money is already debit on bet so we don't need to update)
          await gamePlayer.submitAction(1, 'lose');
          // debit money from user
          await MoneyManager.handleUserTransaction(gamePlayer.user, 'debit', bet, gamePlayer);
        }
        await gamePlayer.user.save();
      }
      this.data.dealerCardsRevealed = true;
      await this.save();
    } else {
      for (const gamePlayer of this.gamePlayers) {
        const totals = Card.getTotals(gamePlayer.hand);
        const bet = gamePlayer.getBetAmount();
        if (totals.indexOf(21) > -1) {
          // player win
          await gamePlayer.submitAction(1, 'win');
          // award user
          await MoneyManager.handleUserTransaction(gamePlayer.user, 'credit', Math.floor(bet * 1.5), gamePlayer);
        }
        await gamePlayer.user.save();
      }
    }
  }

  async endGame() {
    this.data.dealerCardsRevealed = true;
    const dealerHand = this.data.dealerHand;
    let stop = false;
    let sum = Card.getTotal(dealerHand);
    while (!stop && sum < 17) {
      const popped = this.deck.cards.pop();
      if (!popped) {
        throw new Error('could not fetch card from deck for dealer');
      }
      dealerHand.push(popped);
      sum = Card.getTotal(dealerHand);

      if (sum > 17) {
        stop = true;
      }
    }

    // check for bust. if yes, everyone under 21 wins
    for (const gamePlayer of this.gamePlayers) {
      // get highest round
      const maxRound = Math.max(...gamePlayer.gamePlayerRounds.map((round) => round.round));
      const lastRound = gamePlayer.gamePlayerRounds.find((round) => round.round === maxRound);
      if (!lastRound) {
        throw new Error('could not get last round for player');
      }
      const playerTotal = Card.getTotal(gamePlayer.hand);
      // if still in game, add win round
      if (['win', 'lose', 'push'].indexOf(lastRound.action) === -1) {
        let gamePlayerRound;
        const userDTO = await getUserById(gamePlayer.user.id);
        const user = new User(userDTO);
        if (sum > 21 || sum < playerTotal) {
          gamePlayerRound = await gamePlayer.submitAction(lastRound.round, 'win');
          await MoneyManager.handleUserTransaction(gamePlayer.user, 'credit', gamePlayer.getBetAmount(), gamePlayer);
        } else if (sum > playerTotal) {
          gamePlayerRound = await gamePlayer.submitAction(lastRound.round, 'lose');
          await MoneyManager.handleUserTransaction(gamePlayer.user, 'debit', gamePlayer.getBetAmount(), gamePlayer);
        } else {
          gamePlayerRound = await gamePlayer.submitAction(lastRound.round, 'push');
        }
        if (!gamePlayerRound) {
          throw new Error('could not create ending game player round');
        }
      }
    }

    await this.save();
  }

  async save() {
    await updateGame(this);
  }

  async dealToPlayer(gamePlayer : GamePlayer, round : number) {
    const hand : Card[] = [];

    if (this.deck.cards.length < 2) {
      throw new Error('not enough cards in deck to deal to player');
    }

    for (let i = 0; i < 2; i++) {
      const popped = this.deck.cards.pop();
      if (!popped) {
        throw new Error('could not fetch card from deck for player');
      }
      hand.push(popped);
    }
    gamePlayer.hand = hand;
    await gamePlayer.save();

    const gamePlayerRound = await createGamePlayerRound(gamePlayer.id, 'deal', round);
    if (!gamePlayerRound) {
      throw new Error(`could not create game player round for gamePlayerId: ${gamePlayer.id}`);
    }

    await this.save();
  }

  async dealToDealer() {
    const hand : Card[] = [];
    if (this.deck.cards.length < 2) {
      throw new Error('not enough cards in deck to deal to dealer');
    }
    for (let i = 0; i < 2; i++) {
      const popped = this.deck.cards.pop();
      if (!popped) {
        throw new Error('could not fetch card from deck for dealer');
      }
      hand.push(popped);
    }

    const gameData = this.data;
    gameData.dealerHand = hand;
    gameData.deck = this.deck.cards;
    await this.save();
  }
}

export default Game;
