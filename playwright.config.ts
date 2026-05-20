import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end tests.
 *
 * The dev server is launched by Playwright with `E2E_AUTH_BYPASS=1`, which
 * unlocks the `/test-auth/login` route used by the auth fixture to skip
 * the Google OAuth flow. Production builds reject that env var, so this
 * shortcut only exists in dev/test.
 *
 * Single worker by default: tests share the dev database, so isolation
 * comes from each test creating a unique user/room name rather than from
 * parallel DB resets. Bump `workers` once we move to a per-worker DB.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:5273',
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
    url: 'http://localhost:5273',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // Unlocks the test-auth shortcut. Refuses to run in production.
      E2E_AUTH_BYPASS: '1',
    },
  },
});
