import { user } from '@prisma/client';
import { updateUser } from 'actions/user';

class User {
  id : string;
  name : string;
  money : number;

  constructor(user : user) {
    this.id = user.id;
    this.name = user.name;
    this.money = user.money;
  }

  async save() {
    return await updateUser(this);
  }
}

export default User;
