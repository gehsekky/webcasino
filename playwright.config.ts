import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end tests.
 *
 * Stack isolation:
 *   - A dedicated test database `db_webcasino_test`, bootstrapped by
 *     `e2e/global-setup.ts` before any specs run (create-if-missing,
 *     migrate-deploy, truncate-all).
 *   - A separate dev server on port 5274 so the e2e run can coexist
 *     with a developer's local `npm run dev` on 5273. The PORT and
 *     DATABASE_URL are passed via `webServer.env`.
 *   - `E2E_AUTH_BYPASS=1` unlocks `/test-auth/login` so the auth fixture
 *     skips real Google OAuth. The route refuses unless that env var
 *     is set AND `NODE_ENV !== 'production'`.
 *   - `reuseExistingServer: false` keeps us from accidentally pointing
 *     tests at a running dev server that's wired to the dev DB.
 *
 * Single worker by default: tests share the (clean) test database for
 * the run. Bump `workers` once we move to per-worker schemas or DBs.
 */

const TEST_PORT = '5274';
const TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5433/db_webcasino_test?schema=public';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: TEST_PORT,
      E2E_AUTH_BYPASS: '1',
      DATABASE_URL: TEST_DATABASE_URL,
      // Shorten the turn clock so timeout-based specs don't have to wait
      // 30s per test. 2s gives the wrapper enough room to commit and
      // arm the timer before it fires.
      TURN_DURATION_MS: '2000',
    },
  },
});
