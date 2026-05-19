import { Authenticator } from 'remix-auth';
import { sessionStorage } from './session.server';
import { providers } from './providers.server';
import type { SessionUser } from './user.server';

export const authenticator = new Authenticator<SessionUser>(sessionStorage);

for (const provider of providers) {
  authenticator.use(provider.strategy, provider.id);
}
