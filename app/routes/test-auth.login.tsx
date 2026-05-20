import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { prisma } from 'db.server';
import { sessionStorage } from 'auth/session.server';
import { DEFAULT_USER_MONEY } from 'constants/index';

/**
 * E2E-only authentication shortcut. Lets Playwright (or any test harness)
 * skip the real Google OAuth round-trip and obtain a valid session cookie
 * for a named user.
 *
 * SAFETY:
 *  - The route returns 404 unless `E2E_AUTH_BYPASS=1`. Production never
 *    sets that env var; the `playwright.config.ts` webServer block sets
 *    it explicitly when running e2e.
 *  - Beyond the env gate, the route additionally refuses if NODE_ENV
 *    is 'production' as a defense-in-depth check.
 *
 * Contract:
 *  - POST /test-auth/login  body: `name=<display name>`
 *  - Finds an existing user by exact name OR creates one with the default
 *    starting balance. Writes the user shape remix-auth expects under
 *    the session key `'user'`.
 *  - Responds 200 with `Set-Cookie` carrying the session.
 */

function bypassEnabled(): boolean {
  return process.env.E2E_AUTH_BYPASS === '1' && process.env.NODE_ENV !== 'production';
}

export async function loader() {
  if (!bypassEnabled()) {
    throw new Response('not found', { status: 404 });
  }
  return json({ ok: true });
}

export async function action({ request }: ActionFunctionArgs) {
  if (!bypassEnabled()) {
    throw new Response('not found', { status: 404 });
  }

  const formData = await request.formData();
  const name = formData.get('name')?.toString().trim();
  if (!name) {
    throw new Response('name is required', { status: 400 });
  }

  // Find by exact name; otherwise create with default starting money.
  // E2E tests should supply unique names per scenario to avoid collisions.
  let user = await prisma.user.findFirst({ where: { name } });
  if (!user) {
    user = await prisma.user.create({
      data: { name, money: DEFAULT_USER_MONEY },
    });
  }

  const session = await sessionStorage.getSession();
  // remix-auth's Authenticator stores the SessionUser under the key 'user'.
  // Match its shape so `authenticator.isAuthenticated(request)` recognizes it.
  session.set('user', { id: user.id, name: user.name, email: user.email });

  return json(
    { id: user.id, name: user.name },
    {
      headers: { 'Set-Cookie': await sessionStorage.commitSession(session) },
    },
  );
}
