import { Form } from '@remix-run/react';
import Game from 'lib/Game';
import GamePlayer from 'lib/GamePlayer';
import gangsterAvatar from 'public/img/gangster_avatar.jpg';

type SetWagerProps = {
  game : Game;
  gamePlayer : GamePlayer;
};

const SetWager = ({ game, gamePlayer } : SetWagerProps) => {
  return (
    <div className="container flex-row">
      {
        game.gamePlayers.map((currGamePlayer) => {
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
                  <Form method="post">
                    <input type="text" className="input input-bordered w-full max-w-xs" name="amount" />
                    <input type="submit" className="btn" value="place initial bet" name="submit" />
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
              </div>
            );
          }
        })
      }
    </div>
  );
};

export default SetWager;
