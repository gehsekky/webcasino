import { createCookie } from '@remix-run/node';
import { CSRF, CSRFError } from 'remix-utils/csrf/server';

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('SESSION_SECRET environment variable is required');
}

const csrfCookie = createCookie('__webcasino_csrf', {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  secrets: [sessionSecret],
  maxAge: 60 * 60 * 24 * 30,
});

export const csrf = new CSRF({
  cookie: csrfCookie,
  secret: sessionSecret,
});

export { CSRFError };
