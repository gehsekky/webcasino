import { redirect, type ActionFunctionArgs, type MetaFunction } from "@remix-run/node";
import { createNewGameAndGamePlayer } from "actions/game";
import { findOrCreateUserByName } from "actions/user";
import CasinoLanding from "components/CasinoLanding";

export const meta: MetaFunction = () => {
  return [
    { title: "Web Casino" },
    { name: "description", content: "a despicable hive of scum and villainy" },
  ];
};

export async function action({
  request,
} : ActionFunctionArgs) {
  const formData : FormData = await request.formData();
  if (formData.get('submit') === 'create new') {
    const name : string = formData.get('name')?.toString() || '';
    if (!name) {
      throw new Error('must provide name');
    }
    const gameType : string = formData.get('gameType')?.toString() || '';
    if (!gameType) {
      throw new Error('must provide gameType');
    }

    const user = await findOrCreateUserByName(name);
    const {gamePlayer} = await createNewGameAndGamePlayer(gameType, user);
    return redirect(`/game/${gamePlayer.id}`);
  }

  return null;
}

export default function Index() {
  return (
    <CasinoLanding />
  );
}
