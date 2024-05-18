import { Form } from '@remix-run/react';
import Game from 'lib/Game';
import GamePlayer from 'lib/GamePlayer';

type StartGameProps = {
  game : Game;
  gamePlayer : GamePlayer;
};

const StartGame = ({ game, gamePlayer } : StartGameProps) => {
  if (game.createdBy === gamePlayer.user.id) {
    return (
      <Form method="post">
        <input type="submit" name="submit" className="btn" value="start game" />
      </Form>
    );
  } else {
    return (
      <div>waiting for game creator to start game.</div>
    );
  }
};

export default StartGame;
