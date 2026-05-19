import { Form } from '@remix-run/react';
import { buttonClass } from 'lib/buttonStyle';

type ProviderInfo = { id: string; label: string };

type SignInPanelProps = {
  providers: ProviderInfo[];
};

export default function SignInPanel({ providers }: SignInPanelProps) {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-16">
      <div className="max-w-md mx-auto rounded-2xl bg-emerald-950/60 ring-1 ring-emerald-800 p-8 sm:p-10 text-center shadow-2xl">
        <p className="text-5xl mb-3" aria-hidden="true">♠ ♥ ♦ ♣</p>
        <h1 className="text-3xl font-bold text-white mb-2">Welcome to Web Casino</h1>
        <p className="text-emerald-200 mb-8">
          Sign in to take a seat at the table.
        </p>
        {providers.length === 0 ? (
          <p className="text-sm text-orange-300 bg-orange-950/40 ring-1 ring-orange-800 rounded-lg px-4 py-3">
            No identity providers are configured. Set <code>GOOGLE_CLIENT_ID</code> and{' '}
            <code>GOOGLE_CLIENT_SECRET</code> in <code>.env</code>.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {providers.map((provider) => (
              <Form key={provider.id} method="post" action={`/auth/${provider.id}`}>
                <button type="submit" className={buttonClass({ variant: 'primary', className: 'w-full' })}>
                  Sign in with {provider.label}
                </button>
              </Form>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
