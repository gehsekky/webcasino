import { Form, Link } from '@remix-run/react';
import { buttonClass } from 'lib/buttonStyle';

type Viewer = {
  name: string;
  balance: number;
};

type SiteHeaderProps = {
  viewer: Viewer | null;
};

export default function SiteHeader({ viewer }: SiteHeaderProps) {
  return (
    <header className="border-b border-emerald-800/80 bg-emerald-950/80 backdrop-blur sticky top-0 z-10">
      <div className="container mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-baseline gap-2 group">
          <span className="text-2xl font-black tracking-tight text-yellow-400 group-hover:text-yellow-300">
            ♠ Web Casino
          </span>
        </Link>
        {viewer && (
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right hidden sm:block">
              <p className="font-semibold text-white leading-tight">{viewer.name}</p>
              <p className="text-emerald-300 tabular-nums leading-tight">
                ${viewer.balance.toLocaleString()}
              </p>
            </div>
            <div className="text-right sm:hidden">
              <p className="text-emerald-300 tabular-nums font-semibold">
                ${viewer.balance.toLocaleString()}
              </p>
            </div>
            <Form method="post" action="/auth/logout">
              <button type="submit" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                Sign out
              </button>
            </Form>
          </div>
        )}
      </div>
    </header>
  );
}
