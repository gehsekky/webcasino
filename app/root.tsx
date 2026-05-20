import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from '@remix-run/react';
import { json, type LinksFunction, type LoaderFunctionArgs } from '@remix-run/node';
import { AuthenticityTokenProvider } from 'remix-utils/csrf/react';
import { csrf } from 'auth/csrf.server';
import stylesheet from 'tailwind.css?url';

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export async function loader({ request }: LoaderFunctionArgs) {
  const [token, cookieHeader] = await csrf.commitToken(request);
  return json(
    { csrf: token },
    cookieHeader ? { headers: { 'Set-Cookie': cookieHeader } } : undefined,
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="notranslate" translate="no">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <LiveReload />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { csrf } = useLoaderData<typeof loader>();
  return (
    <AuthenticityTokenProvider token={csrf}>
      <Outlet />
    </AuthenticityTokenProvider>
  );
}

/**
 * Catches any loader/action/render error that escapes the route tree.
 * In dev we surface the actual message + stack to make bugs debuggable;
 * production would benefit from a Sentry report + a friendlier fallback
 * (tracked in the production-readiness TODO).
 */
export function ErrorBoundary() {
  const error = useRouteError();

  let title = 'Something went wrong';
  let detail: string | undefined;
  let stack: string | undefined;
  let status: number | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    title = `${error.status} ${error.statusText}`;
    detail = typeof error.data === 'string' ? error.data : JSON.stringify(error.data);
  } else if (error instanceof Error) {
    title = error.name || 'Error';
    detail = error.message;
    stack = error.stack;
  } else {
    detail = String(error);
  }

  return (
    <main className="min-h-screen bg-emerald-950 text-white p-8">
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-red-300">{title}</h1>
        {status === 404 ? (
          <p className="text-emerald-200">That page does not exist.</p>
        ) : (
          detail && (
            <pre className="whitespace-pre-wrap break-words rounded bg-black/40 p-4 text-sm text-emerald-100 ring-1 ring-red-700/40">
              {detail}
            </pre>
          )
        )}
        {stack && (
          <details className="text-xs">
            <summary className="cursor-pointer text-emerald-200/70 hover:text-emerald-200">
              stack trace
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-black/40 p-4 text-[11px] text-emerald-100/80 ring-1 ring-emerald-700/40">
              {stack}
            </pre>
          </details>
        )}
        <a href="/" className="inline-block mt-4 underline text-emerald-200 hover:text-white">
          ← Back to lobby
        </a>
      </div>
    </main>
  );
}
