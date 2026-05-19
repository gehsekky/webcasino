import { ChangeEventHandler, useState } from "react";
import { Form } from '@remix-run/react';
import Header from "components/Header";

type ProviderInfo = { id: string; label: string };

type SessionUserInfo = {
  id: string;
  name: string;
  email: string | null;
};

type CasinoLandingProps = {
  user: SessionUserInfo | null;
  providers: ProviderInfo[];
};

const CasinoLanding = ({ user, providers }: CasinoLandingProps) => {
  const [gamePlayerId, setGamePlayerId] = useState<string>('');

  const onChangeHandlerResume: ChangeEventHandler<HTMLInputElement> = (e) => {
    setGamePlayerId(e.target?.value ?? '');
  };

  const onSubmitHandlerResume = () => {
    window.open(`/game/${gamePlayerId}`, '_blank', 'noopener, noreferrer');
  };

  return (
    <>
      <Header title="web casino" />
      <div className="container mx-auto">
        <div className="hero min-h-80 bg-base-200">
          <div className="hero-content text-center flex-col">
            <h1 className="text-4xl text-center">welcome to the casino</h1>

            {!user ? (
              <div>
                <p className="text-lg">sign in to play</p>
                {providers.map((provider) => (
                  <Form key={provider.id} method="post" action={`/auth/${provider.id}`}>
                    <input
                      type="submit"
                      className="btn border border-solid border-black m-1"
                      value={`Sign in with ${provider.label}`}
                    />
                  </Form>
                ))}
              </div>
            ) : (
              <>
                <p className="text-sm">
                  signed in as <strong>{user.name}</strong>
                  {user.email ? ` (${user.email})` : ''}
                  <Form method="post" action="/auth/logout" style={{ display: 'inline' }}>
                    <button type="submit" className="btn btn-xs ml-2 border border-solid border-black">
                      sign out
                    </button>
                  </Form>
                </p>

                <p className="text-lg">new game</p>
                <div>
                  <Form method="post">
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
                    <input type="submit" name="submit" className="btn border border-solid border-black" value="create new" />
                  </Form>
                </div>

                <p className="text-lg">resume game</p>
                <div>
                  <Form reloadDocument onSubmit={onSubmitHandlerResume} navigate={false}>
                    <div><input type="text" onChange={onChangeHandlerResume} className="input input-bordered w-full max-w-xs m-2" placeholder="game player id" /></div>
                    <div><input type="submit" name="submit" className="btn border border-solid border-black" value="resume" /></div>
                  </Form>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default CasinoLanding;
