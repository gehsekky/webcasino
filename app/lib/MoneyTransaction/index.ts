import { MoneyTransactionDTO } from 'actions/moneyTransaction';

class MoneyTransaction {
  id : string;
  userId : string;
  gamePlayerId : string | null;
  type : string;
  amount : number;
  note : string | null;

  constructor(moneyTransactionDTO : MoneyTransactionDTO) {
    this.id = moneyTransactionDTO.id;
    this.userId = moneyTransactionDTO.user_id;
    this.gamePlayerId = moneyTransactionDTO.game_player_id;
    this.type = moneyTransactionDTO.type;
    this.amount = moneyTransactionDTO.amount;
    this.note = moneyTransactionDTO.note;
  }
}

export default MoneyTransaction;
