import { randomInt } from 'node:crypto';
import Card from 'lib/Card';

class Deck {
  cards : Card[];

  constructor() {
    this.cards = [];
    this.initialize();
  }

  static createNewDeckFromCards(cards : Card[]) {
    const deck = new Deck();
    deck.cards = cards;
    return deck;
  }

  initialize() {
    for (let i = 0; i < Card.suits.length; i++) {
      for (let j = 0; j < Card.ranks.length; j++) {
        this.cards.push(new Card(Card.suits[i], Card.ranks[j]));
      }
    }

    this.shuffle();
  }

  shuffle() {
    // Fisher-Yates with crypto.randomInt for CSPRNG-backed shuffling.
    // Server-only (node:crypto) — importing this from a browser bundle
    // fails at module load by design.
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }
}

export default Deck;
