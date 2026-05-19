import { createCookieSessionStorage } from '@remix-run/node';

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('SESSION_SECRET environment variable is required');
}

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: '__webcasino_session',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [sessionSecret],
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
});

export const { getSession, commitSession, destroySession } = sessionStorage;
