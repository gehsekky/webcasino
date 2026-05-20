import { test as base, expect, type Page } from '@playwright/test';
export type { Page } from '@playwright/test';

/**
 * Playwright fixtures for the casino.
 *
 * The default `test` here extends Playwright's with:
 *   - `freshUserName`: a per-test unique display name. Use it whenever a
 *     spec creates or signs in as a user so concurrent runs don't collide.
 *   - `authedPage`: a page that's already signed in as a fresh user.
 *     Behind the scenes it POSTs to `/test-auth/login`, which is unlocked
 *     by `E2E_AUTH_BYPASS=1` in `playwright.config.ts`.
 *
 * Specs can then just `test('...', async ({ authedPage }) => { ... })`
 * without repeating the sign-in dance.
 */

type Fixtures = {
  freshUserName: string;
  authedPage: Page;
};

let counter = 0;
function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  freshUserName: async ({}, use, testInfo) => {
    // Combine the test title with a counter for human-readable trace
    // names; collisions across parallel runs are still avoided by the
    // timestamp + counter pair.
    const safeTitle = testInfo.title.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 24);
    await use(uniqueName(`e2e-${safeTitle || 'user'}`));
  },

  authedPage: async ({ page, freshUserName }, use) => {
    // Use the page's own browser-context request API so cookies set by
    // the bypass endpoint land on the same context as page.goto(...).
    // The top-level `request` fixture is a SEPARATE APIRequestContext
    // with its own cookie jar — using it would auth nothing for the page.
    const resp = await page.context().request.post('/test-auth/login', {
      form: { name: freshUserName },
    });
    expect(resp.ok(), `test-auth bypass failed (${resp.status()})`).toBeTruthy();

    await use(page);
  },
});

export { expect };
