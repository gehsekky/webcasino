import { GamePlayerRoundDTO } from 'actions/gamePlayer';
import Card from 'lib/Card';

export type GamePlayerRoundData = {
  // hit/stay/
  action: string;
  hand: Card[];
};

class GamePlayerRound {
  gamePlayerId : string;
  round : number;
  data : GamePlayerRoundData;

  constructor(gamePlayerRoundDTO : GamePlayerRoundDTO) {
    this.gamePlayerId = gamePlayerRoundDTO.game_player_id;
    this.round = gamePlayerRoundDTO.round;
    this.data = gamePlayerRoundDTO.data as unknown as GamePlayerRoundData;
  }
}

export default GamePlayerRound;
