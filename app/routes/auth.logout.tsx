import type { ActionFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { authenticator } from 'auth/authenticator.server';

export async function action({ request }: ActionFunctionArgs) {
  return authenticator.logout(request, { redirectTo: '/' });
}

export async function loader() {
  return redirect('/');
}
