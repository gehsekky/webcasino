import { GameDTO, updateGame } from 'actions/game';
import { createGamePlayerRound } from 'actions/gamePlayerRound';
import Card from 'lib/Card';
import Deck from 'lib/Deck';
import GamePlayer from 'lib/GamePlayer';
import { GamePlayerRoundData } from 'lib/GamePlayerRound';

export interface GameData {
  type: string;
  minimumBet: number;
  maximumBet: number;
  deck: Card[];
  currentRound: number;
  dealerHand: Card[],
  dealerCardsRevealed: false,
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
    const gamePlayerRoundData : GamePlayerRoundData = {
      hand,
      action: 'deal'
    };
    const gamePlayerRound = await createGamePlayerRound(gamePlayer.id, gamePlayerRoundData, round);
    if (!gamePlayerRound) {
      throw new Error(`could not create game player round for gamePlayerId: ${gamePlayer.id}`);
    }
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
    gameData.currentRound = 1;
    gameData.dealerHand = hand;
    await this.save();
  }
}

export default Game;
