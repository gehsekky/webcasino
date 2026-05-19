import { redirect } from '@remix-run/node';
import { prisma } from 'db.server';
import { authenticator } from './authenticator.server';
import type { SessionUser } from './user.server';

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await authenticator.isAuthenticated(request);
  if (!user) {
    throw redirect('/');
  }
  return user;
}

export async function getOptionalUser(request: Request): Promise<SessionUser | null> {
  return authenticator.isAuthenticated(request);
}

export async function requireSeat(
  request: Request,
  gamePlayerId: string,
): Promise<SessionUser> {
  const user = await requireUser(request);
  const seat = await prisma.hand_seat.findUnique({
    where: { id: gamePlayerId },
    select: { user_id: true },
  });
  if (!seat || seat.user_id !== user.id) {
    throw redirect('/');
  }
  return user;
}
