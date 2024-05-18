import { createGamePlayerRoundForAction, updateGamePlayer, type GamePlayerDTO } from 'actions/gamePlayer';
import Card from 'lib/Card';
import GamePlayerBet from 'lib/GamePlayerBet';
import GamePlayerRound from 'lib/GamePlayerRound';
import MoneyManager from 'lib/MoneyManager';
import User from 'lib/User';

export type GamePlayerData = {
  cards : Card[];
}

class GamePlayer {
  id : string;
  gameId : string;
  user : User;
  hand : Card[];
  gamePlayerBets : GamePlayerBet[];
  gamePlayerRounds : GamePlayerRound[];

  constructor(gamePlayerDTO : GamePlayerDTO) {
    this.id = gamePlayerDTO.id;
    this.gameId = gamePlayerDTO.game_id;
    this.user = new User(gamePlayerDTO.user);
    this.gamePlayerBets = gamePlayerDTO.game_player_bet?.map((gamePlayerBet) => {
      return new GamePlayerBet(gamePlayerBet);
    }) ?? [];
    this.gamePlayerRounds = gamePlayerDTO.game_player_round?.map((gamePlayerRound) => {
      return new GamePlayerRound(gamePlayerRound)
    });
    this.hand = (gamePlayerDTO.data as unknown as GamePlayerData).cards;
  }

  getBetAmount() {
    if (!this.gamePlayerBets || !this.gamePlayerBets.length) {
      throw new Error('could not access player bets');
    }
    const initialBet = this.gamePlayerBets.find((playerBet) => playerBet.type === 'initial');
    if (!initialBet) {
      throw new Error('could not get initial player bet');
    }
    const isDoubleDown = this.gamePlayerRounds.some((gamePlayerRound) => gamePlayerRound.action === 'double down');
    let betAmount = initialBet.amount;
    if (isDoubleDown) {
      betAmount += betAmount;
    }
    return betAmount;
  }

  async submitAction(currentRound: number, action : string) {
    const gamePlayerRound = await createGamePlayerRoundForAction(this, currentRound, action);
    if (!gamePlayerRound) {
      throw new Error('could not create game player round for action');
    }

    if (['hit', 'double down'].indexOf(action) > -1) {
      // check for bust and add record if necessary
      if (Card.isBust(this.hand)) {
        await createGamePlayerRoundForAction(this, currentRound + 1, 'lose');
        const bet = this.getBetAmount();
        await MoneyManager.handleUserTransaction(this.user, 'debit', bet, this);
      } else if (action === 'double down') {
        await createGamePlayerRoundForAction(this, currentRound + 1, 'stay');
      }
    } else if (action === 'surrender') {
      await createGamePlayerRoundForAction(this, currentRound + 1, 'lose');
      const bet = this.getBetAmount();
      await MoneyManager.handleUserTransaction(this.user, 'debit', Math.ceil(bet / 2), this);
    }

    return gamePlayerRound;
  }

  async save() {
    await updateGamePlayer(this);
  }
}

export default GamePlayer;
