import { GamePlayerBetDTO } from 'actions/gamePlayer';

class GamePlayerBet {
  id : string;
  gamePlayerId : string;
  amount : number;
  type : string;

  constructor(gamePlayerBetDTO : GamePlayerBetDTO) {
    this.id = gamePlayerBetDTO.id;
    this.gamePlayerId = gamePlayerBetDTO.game_player_id;
    this.amount = gamePlayerBetDTO.amount;
    this.type = gamePlayerBetDTO.type;
  }
}

export default GamePlayerBet;
