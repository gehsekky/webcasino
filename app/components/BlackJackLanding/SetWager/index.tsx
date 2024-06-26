import { Form } from '@remix-run/react';
import { GameDTO } from 'actions/game';
import { GamePlayerDTO } from 'actions/gamePlayer';
import gangsterAvatar from 'public/img/gangster_avatar.jpg';

type SetWagerProps = {
  game : GameDTO;
  gamePlayer : GamePlayerDTO;
};

const SetWager = ({ game, gamePlayer } : SetWagerProps) => {
  return (
    <div className="container flex-row">
      {
        game.game_player.map((currGamePlayer) => {
          if (currGamePlayer.id === gamePlayer.id) {
            return (
              <div key={currGamePlayer.id}>
                <div className="avatar">
                  <div className="w-24 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2">
                    <img src={gangsterAvatar} alt="profile avatar" />
                    <a href="https://www.freepik.com/free-vector/mysterious-mafia-man-smoking-cigarette_7074311.htm#query=avatar&position=1&from_view=keyword&track=sph&uuid=5de6d072-1a97-44cb-8b2b-7562679e6c5a">Image by pikisuperstar on Freepik</a>
                  </div>
                </div>
                <div>
                  <div>{currGamePlayer.user.name}</div>
                  <div>money: {currGamePlayer.user.money}</div>
                </div>
                <div>
                  <Form method="post">
                    <input type="text" className="input input-bordered w-full max-w-xs m-2" name="amount" />
                    <input type="submit" className="btn border border-solid border-black" value="place initial bet" name="submit" />
                  </Form>
                </div>
              </div>
            );
          } else {
            return (
              <div key={currGamePlayer.id}>
                <div className="avatar">
                  <div className="w-24 rounded-full">
                    <img src={gangsterAvatar} alt="profile avatar" />
                    <a href="https://www.freepik.com/free-vector/mysterious-mafia-man-smoking-cigarette_7074311.htm#query=avatar&position=1&from_view=keyword&track=sph&uuid=5de6d072-1a97-44cb-8b2b-7562679e6c5a">Image by pikisuperstar on Freepik</a>
                  </div>
                </div>
                <div>
                  <div>{currGamePlayer.user.name}</div>
                  <div>money: {currGamePlayer.user.money}</div>
                </div>
              </div>
            );
          }
        })
      }
    </div>
  );
};

export default SetWager;
