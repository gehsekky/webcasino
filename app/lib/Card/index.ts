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

  static getTotals(cards : Card[]) : number[] {
    let sum = 0, numAces = 0;
    for (let i = 0; i < cards.length; i++) {
      let cardValue;
      switch (cards[i].rank) {
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          cardValue = parseInt(cards[i].rank);
          break;
        case 'Jack':
        case 'Queen':
        case 'King':
          cardValue = 10;
          break;
        case 'Ace':
          cardValue = 1;
          numAces++;
          break;
        case 'hidden':
          cardValue = 0;
          break;
        default:
          throw new Error('unknown card rank');
      }
      sum += cardValue;
    }
    let totals = [sum];
    for (let i = 0; i < numAces; i++) {
      const subTotals = [];
      for (let j = 0; j < totals.length; j++) {
        subTotals.push(totals[j] + 10);
      }
      totals = totals.concat(subTotals);
    }
    const totalsSet = new Set(totals);
    totals = Array.from(totalsSet);
    return totals;
  };

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
