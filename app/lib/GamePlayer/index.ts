import { createGamePlayerRoundForAction, type GamePlayerDTO } from 'actions/gamePlayer';
import GamePlayerBet from 'lib/GamePlayerBet';
import GamePlayerRound, { GamePlayerRoundData } from 'lib/GamePlayerRound';
import User from 'lib/User';

class GamePlayer {
  id : string;
  gameId : string;
  active : boolean;
  user : User;
  gamePlayerBets : GamePlayerBet[];
  gamePlayerRounds : GamePlayerRound[];

  constructor(gamePlayerDTO : GamePlayerDTO) {
    this.id = gamePlayerDTO.id;
    this.gameId = gamePlayerDTO.game_id;
    this.active = gamePlayerDTO.active;
    this.user = new User(gamePlayerDTO.user);
    this.gamePlayerBets = gamePlayerDTO.game_player_bet?.map((gamePlayerBet) => {
      return new GamePlayerBet(gamePlayerBet);
    }) ?? [];
    this.gamePlayerRounds = gamePlayerDTO.game_player_round?.map((gamePlayerRound) => {
      return new GamePlayerRound(gamePlayerRound)
    });
  }

  async submitAction(currentRound: number, action : string) : Promise<void> {
    const gamePlayerRound = await createGamePlayerRoundForAction(this, currentRound, action);
    if (!gamePlayerRound) {
      throw new Error('could not create game player round for action');
    }
    // check for bust
    const hand = (gamePlayerRound.data as unknown as GamePlayerRoundData).hand;

  }
}

export default GamePlayer;
