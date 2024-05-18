import Deck from 'lib/Deck';
import Game from '../Game';
import type { GameDTO } from 'actions/game';

class BlackJack extends Game {
  deck : Deck;

  constructor(gameDTO : GameDTO) {
    super(gameDTO);
    this.deck = new Deck();
  }
}

export default BlackJack;
