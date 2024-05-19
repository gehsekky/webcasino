class Card {
  suit : string;
  rank : string;

  static suits : string[] = ['hearts', 'spades', 'clubs', 'diamonds'];
  static ranks : string[] = ['Ace', '2', '3', '4', '5', '6', '7', '8', '9', 'Jack', 'Queen', 'King'];

  constructor(suit : string, rank : string) {
    this.suit = suit;
    this.rank = rank;
  }

  static getTotal(cards : Card[]) {
    let sum = 0;
    let hasAce = false;
    for (const card of cards) {
      if (['2', '3', '4', '5', '6', '7', '8', '9'].indexOf(card.rank) > -1) {
        sum += parseInt(card.rank);
      } else if (['Jack', 'Queen', 'King'].indexOf(card.rank) > -1) {
        sum += 10;
      } else if (card.rank === 'Ace') {
        if (!hasAce) {
          sum += 11;
          hasAce = true;
        } else {
          sum += 1;
        }
      } else if (card.rank === 'hidden') {
        sum += 0;
      } else {
        throw new Error('unhandled card case while ending game');
      }
    }

    if (sum > 21 && hasAce) {
      sum -= 10;
    }

    return sum;
  }

  static has21(cards : Card[]) : boolean {
    const total = Card.getTotal(cards);
    if (total === 21) {
      return true;
    }

    return false;
  }

  static isBust(cards : Card[]) : boolean {
    const total = Card.getTotal(cards);
    if (total > 21) {
      return true;
    }

    return false;
  }
}

export default Card;
