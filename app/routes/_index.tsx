import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { createNewGameAndGamePlayer } from "actions/game.server";
import { prisma } from "db.server";
import { getOptionalUser, requireUser } from "auth/guards.server";
import { providers } from "auth/providers.server";
import CasinoLanding from "components/CasinoLanding";

export const meta: MetaFunction = () => {
  return [
    { title: "Web Casino" },
    { name: "description", content: "a despicable hive of scum and villainy" },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getOptionalUser(request);
  return {
    user,
    providers: providers.map((p) => ({ id: p.id, label: p.label })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const formData: FormData = await request.formData();

  if (formData.get('submit') === 'create new') {
    const gameType: string = formData.get('gameType')?.toString() || '';
    if (!gameType) {
      throw new Error('must provide gameType');
    }

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const { gamePlayer } = await createNewGameAndGamePlayer(gameType, dbUser);
    return redirect(`/game/${gamePlayer.id}`);
  }

  return null;
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  return (
    <CasinoLanding user={data.user} providers={data.providers} />
  );
}
