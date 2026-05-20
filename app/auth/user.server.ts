import { prisma } from 'db.server';
import { DEFAULT_USER_MONEY } from 'constants/index';

/**
 * The minimal user shape stored in the session.
 * Keep it small; refetch fresh data via prisma when full state is needed.
 */
export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
};

export async function findOrCreateUserByOAuth(params: {
  provider: string;
  providerUserId: string;
  email?: string;
  displayName: string;
}): Promise<SessionUser> {
  const { provider, providerUserId, email, displayName } = params;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.oauth_identity.findUnique({
      where: { provider_provider_user_id: { provider, provider_user_id: providerUserId } },
      include: { user: true },
    });

    if (existing) {
      return toSessionUser(existing.user);
    }

    const userByEmail = email ? await tx.user.findUnique({ where: { email } }) : null;

    const user = userByEmail
      ? userByEmail
      : await tx.user.create({
          data: {
            name: displayName,
            email,
            money: DEFAULT_USER_MONEY,
          },
        });

    await tx.oauth_identity.create({
      data: {
        user_id: user.id,
        provider,
        provider_user_id: providerUserId,
        email,
      },
    });

    return toSessionUser(user);
  });
}

function toSessionUser(u: { id: string; name: string; email: string | null }): SessionUser {
  return { id: u.id, name: u.name, email: u.email };
}
