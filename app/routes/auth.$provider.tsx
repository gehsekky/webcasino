import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { authenticator } from 'auth/authenticator.server';
import { providerById } from 'auth/providers.server';

export async function loader({ params }: LoaderFunctionArgs) {
  // Direct GET to /auth/:provider just bounces home — sign-in goes via POST.
  if (!params.provider || !providerById(params.provider)) {
    return redirect('/');
  }
  return redirect('/');
}

export async function action({ request, params }: ActionFunctionArgs) {
  const providerId = params.provider;
  if (!providerId || !providerById(providerId)) {
    throw redirect('/');
  }
  return authenticator.authenticate(providerId, request);
}
