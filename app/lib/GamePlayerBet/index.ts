import { GamePlayerBetDTO } from 'actions/gamePlayer';

class GamePlayerBet {
  // initial
  amount : number;
  type : string;

  constructor(gamePlayerBetDTO : GamePlayerBetDTO) {
    this.amount = gamePlayerBetDTO.amount;
    this.type = gamePlayerBetDTO.type;
  }
}

export default GamePlayerBet;
