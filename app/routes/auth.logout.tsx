import type { ActionFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { authenticator } from 'auth/authenticator.server';
import { csrf, CSRFError } from 'auth/csrf.server';

export async function action({ request }: ActionFunctionArgs) {
  try {
    await csrf.validate(request.clone());
  } catch (e) {
    if (e instanceof CSRFError) throw new Response('invalid CSRF token', { status: 403 });
    throw e;
  }
  return authenticator.logout(request, { redirectTo: '/' });
}

export async function loader() {
  return redirect('/');
}
