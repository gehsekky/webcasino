import libCard from 'lib/Card';
import hearts from 'public/img/hearts.svg';
import clubs from 'public/img/clubs.svg';
import diamonds from 'public/img/diamonds.svg';
import spades from 'public/img/spades.svg';
import help from 'public/img/help.svg';

type CardProps = {
  card: libCard;
};

const Card = ({ card } : CardProps) => {
  const imageMap : { [key : string] : string } = {
    'hearts': hearts,
    'clubs': clubs,
    'diamonds': diamonds,
    'spades': spades,
    'hidden': help,
  };

  return (
    <div className="card w-30 bg-base-100 shadow-xl card-bordered border-black m-1 p-1">
      <figure>
        <img src={imageMap[card.suit]} alt={card.suit} width={80} />
      </figure>
      <div className="card-body items-center text-center">
        <h2 className="card-title text-3xl">{card.rank !== 'hidden' ? card.rank : ''}</h2>
      </div>
    </div>
  );
};

export default Card;
