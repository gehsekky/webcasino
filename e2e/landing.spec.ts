import { test, expect } from './fixtures';

test.describe('Landing page', () => {
  test('unauthed visitor sees the sign-in panel', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Welcome to Web Casino/i })).toBeVisible();
    // Either the Google button or the "no providers configured" notice
    // is acceptable — we just want the unauthed surface.
    const signInOrNotice = page
      .getByRole('button', { name: /Sign in with/i })
      .or(page.getByText(/No identity providers are configured/i));
    await expect(signInOrNotice).toBeVisible();
  });

  test('authed user sees their landing dashboard', async ({ authedPage, freshUserName }) => {
    await authedPage.goto('/');
    // Header includes the user's name in the viewer block.
    await expect(authedPage.getByText(freshUserName)).toBeVisible();
    // Authed users see the create-game CTA.
    await expect(authedPage.getByRole('button', { name: /\+ Create game/i })).toBeVisible();
    await expect(authedPage.getByRole('heading', { name: /Your games/i })).toBeVisible();
  });
});
