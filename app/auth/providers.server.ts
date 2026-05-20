import type { Strategy } from 'remix-auth';
import { GoogleStrategy } from 'remix-auth-google';
import type { SessionUser } from './user.server';
import { findOrCreateUserByOAuth } from './user.server';

/**
 * One entry per OAuth provider. To add a new provider:
 *   1. Install its remix-auth strategy package.
 *   2. Append a factory to `providerFactories` with `id` matching the OAuth route segment.
 *   3. Set the corresponding env vars in `.env`.
 * No other file in the auth layer needs to change.
 *
 * Providers whose env vars are missing are silently omitted from the active
 * registry. This lets the server boot in environments where only some
 * providers are configured (e.g. local dev without a Google OAuth app yet).
 */
export type OAuthProvider = {
  id: string;
  label: string;
  strategy: Strategy<SessionUser, unknown>;
};

type ProviderFactory = {
  id: string;
  label: string;
  requiredEnv: string[];
  build: () => Strategy<SessionUser, unknown>;
};

const APP_URL = () => process.env.APP_URL ?? 'http://localhost:3000';

const providerFactories: ProviderFactory[] = [
  {
    id: 'google',
    label: 'Google',
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    build: () =>
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          callbackURL: `${APP_URL()}/auth/google/callback`,
        },
        async ({ profile }) => {
          const email = profile.emails[0]?.value;
          return findOrCreateUserByOAuth({
            provider: 'google',
            providerUserId: profile.id,
            email,
            displayName: profile.displayName,
          });
        },
      ) as unknown as Strategy<SessionUser, unknown>,
  },
];

function buildProviders(): OAuthProvider[] {
  const active: OAuthProvider[] = [];
  for (const factory of providerFactories) {
    const missing = factory.requiredEnv.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      console.warn(`[auth] skipping provider '${factory.id}': missing env ${missing.join(', ')}`);
      continue;
    }
    active.push({ id: factory.id, label: factory.label, strategy: factory.build() });
  }
  return active;
}

export const providers: OAuthProvider[] = buildProviders();

export const providerById = (id: string): OAuthProvider | undefined =>
  providers.find((p) => p.id === id);
