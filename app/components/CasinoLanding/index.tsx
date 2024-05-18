import { ChangeEventHandler, useState } from "react";
import { Form } from '@remix-run/react';
import Header from "components/Header";

const CasinoLanding = () => {
  const [gamePlayerId, setGamePlayerId] = useState<string>('');

  const onChangeHandlerResume : ChangeEventHandler<HTMLInputElement> = (e) => {
    setGamePlayerId(e.target?.value ?? '');
  };
  
  const onSubmitHandlerResume = () => {
    window.open(`/game/${gamePlayerId}`, '_blank', 'noopener, noreferrer');
  };

  return (
    <>
      <Header title="web casino" />
      <div className="container mx-auto">
        <div className="hero min-h-screen bg-base-200">
          <div className="hero-content text-center flex-col">
            <h1 className="text-4xl text-center">welcome to the casino</h1>
            <p className="text-lg">new game</p>
            <div>
              <Form method="post">
                <input type="text" name="name" />
                <div className="form-control">
                  <label className="label cursor-pointer">
                    <span className="label-text">blackjack</span> 
                    <input type="radio" name="gameType" className="radio checked:bg-red-500" defaultChecked={true} value="blackjack" />
                  </label>
                </div>
                <div className="form-control">
                  <label className="label cursor-pointer">
                    <span className="label-text">poker</span> 
                    <input type="radio" name="gameType" className="radio checked:bg-blue-500" value="poker" />
                  </label>
                </div>
                <input type="submit" name="submit" className="btn" value="create new" />
              </Form>
            </div>

            <p className="text-lg">resume game</p>
            <div>
              <Form reloadDocument onSubmit={onSubmitHandlerResume} navigate={false}>
                <input type="text" onChange={onChangeHandlerResume} />
                <input type="submit" name="submit" className="btn" value="resume" />
              </Form>
            </div>
          </div>
        </div>
      </div>
    </>

  );
};

export default CasinoLanding;
