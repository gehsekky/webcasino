import { createGamePlayerRoundForAction, updateGamePlayer, type GamePlayerDTO } from 'actions/gamePlayer';
import Card from 'lib/Card';
import GamePlayerBet from 'lib/GamePlayerBet';
import GamePlayerRound from 'lib/GamePlayerRound';
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

  getInitialBetAmount() {
    if (!this.gamePlayerBets || !this.gamePlayerBets.length) {
      throw new Error('could not access player bets');
    }
    const initialBet = this.gamePlayerBets.find((playerBet) => playerBet.type === 'initial');
    if (!initialBet) {
      throw new Error('could not get initial player bet');
    }

    return initialBet.amount;
  }

  async submitAction(currentRound: number, action : string) {
    const gamePlayerRound = await createGamePlayerRoundForAction(this, currentRound, action);
    if (!gamePlayerRound) {
      throw new Error('could not create game player round for action');
    }

    if (action === 'hit') {
      // check for bust and add record if necessary
      const totals = Card.getTotals(this.hand);
      if (totals.every((total) => total > 21)) {
        await createGamePlayerRoundForAction(this, currentRound + 1, 'lose');
        const bet = this.getInitialBetAmount();
        this.user.money -= bet;
        await this.user.save();
      }
    } else if (action === 'surrender') {
      await createGamePlayerRoundForAction(this, currentRound + 1, 'lose');
      const bet = this.getInitialBetAmount();
      this.user.money -= Math.ceil(bet / 2);
      await this.user.save();
    }

    return gamePlayerRound;
  }

  async save() {
    await updateGamePlayer(this);
  }
}

export default GamePlayer;
