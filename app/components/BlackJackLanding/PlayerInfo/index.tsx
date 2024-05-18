import Card from 'lib/Card';
import CardComponent from 'components/Card';

type PlayerInfoProps = {
  name : string;
  money? : number;
  currentBet? : number;
  cards : Card[];
  isCurrentPlayer : boolean;
}

const PlayerInfo = ({ name, money, currentBet, cards, isCurrentPlayer } : PlayerInfoProps) => {

  return (
    <div key={name} className={'border-solid border-black p-2 rounded m-2 ' + (isCurrentPlayer ? 'border-4' : 'border')}>
      <h3 className="text-4xl p-1">{name}</h3>
      <div className="p-1">{money !== undefined ? `money: ${money}` : <span>&nbsp;</span>}</div>
      <div className="p-1">{currentBet !== undefined ? `current bet: ${currentBet}` : <span>&nbsp;</span>}</div>
      <div className="flex flex-row">
        {
          cards.map((card) => <CardComponent key={card.suit + card.rank} card={card} />)
        }
      </div>
      <div>total: {Card.getTotal(cards)}</div>
    </div>
  );
};

export default PlayerInfo;
