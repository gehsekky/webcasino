import { vitePlugin as remix } from '@remix-run/dev';
import { installGlobals } from '@remix-run/node';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

installGlobals();

// Port is overridable via the `PORT` env var so the Playwright config
// can spin up the e2e dev server on a different port (5274) without
// clobbering a developer's locally-running `npm run dev` on 5273.
const port = parseInt(process.env.PORT ?? '5273', 10);

export default defineConfig({
  server: {
    port,
  },
  plugins: [remix(), tsconfigPaths()],
});
