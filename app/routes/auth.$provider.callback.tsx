import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { authenticator } from 'auth/authenticator.server';
import { providerById } from 'auth/providers.server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const providerId = params.provider;
  if (!providerId || !providerById(providerId)) {
    throw redirect('/');
  }
  return authenticator.authenticate(providerId, request, {
    successRedirect: '/',
    failureRedirect: '/',
  });
}
