import { user } from '@prisma/client';

class User {
  id : string;
  name : string;
  money : number;

  constructor(user : user) {
    this.id = user.id;
    this.name = user.name;
    this.money = user.money;
  }
}

export default User;
