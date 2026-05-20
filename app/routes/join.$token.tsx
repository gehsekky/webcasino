import { type LoaderFunctionArgs, redirect } from '@remix-run/node';
import { requireUser } from 'auth/guards.server';
import { joinViaToken } from 'actions/tableLifecycle.server';

/**
 * Shareable join link target. If the visitor is already seated at the
 * room, drop them straight in. Otherwise upsert a pending invitation
 * and send them to the landing page where they accept/decline.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = params.token;
  if (!token) throw new Response('token required', { status: 400 });
  const user = await requireUser(request);

  const result = await joinViaToken({ visitor: user, token });

  if (result.kind === 'already_seated') {
    return redirect(`/rooms/${result.roomId}`);
  }

  // already_invited or invited: pop up at the landing page where they can
  // accept. (If they had already declined and revisit the link we let
  // the existing 'declined' row stand; they can flip it via the UI.)
  return redirect('/');
}

export default function JoinRoute() {
  return null;
}
