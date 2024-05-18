import { GamePlayerRoundDTO } from 'actions/gamePlayer';

class GamePlayerRound {
  gamePlayerId : string;
  round : number;
  action : string;

  constructor(gamePlayerRoundDTO : GamePlayerRoundDTO) {
    this.gamePlayerId = gamePlayerRoundDTO.game_player_id;
    this.round = gamePlayerRoundDTO.round;
    this.action = gamePlayerRoundDTO.action;
  }
}

export default GamePlayerRound;
