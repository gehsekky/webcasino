import { hand_seat_round } from '@prisma/client';
import { Link } from '@remix-run/react';

type PlayerOutcomeProps = {
  gamePlayerRound : hand_seat_round;
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
