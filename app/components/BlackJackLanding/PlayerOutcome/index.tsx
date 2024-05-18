import { Link } from '@remix-run/react';
import GamePlayerRound from 'lib/GamePlayerRound';

type PlayerOutcomeProps = {
  gamePlayerRound : GamePlayerRound;
}

const PlayerOutcome = ({ gamePlayerRound } : PlayerOutcomeProps) => {
  return (
    <div>
      <div>outcome: {gamePlayerRound.action}</div>
      <div><Link to="/"><button className="btn border border-solid border-black">new game</button></Link></div>
    </div>
  );
};

export default PlayerOutcome;
