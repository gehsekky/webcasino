import { createMoneyTransaction } from 'actions/moneyTransaction';
import GamePlayer from 'lib/GamePlayer';
import User from 'lib/User';

class MoneyManager {
  static async handleUserTransaction(user : User, type : string, amount : number, gamePlayer? : GamePlayer) {
    if (type === 'debit') {
      user.money -= amount;
    } else if (type === 'credit') {
      user.money += amount;
    } else {
      throw new Error('unknown money transaction type');
    }
    await user.save();

    const moneyTransaction = await createMoneyTransaction(user.id, type, amount, gamePlayer?.id);
    if (!moneyTransaction) {
      throw new Error('could not create money transaction for user');
    }
    return moneyTransaction;
  }
}

export default MoneyManager;
