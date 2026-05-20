import { test, expect, type Page } from './fixtures';

/**
 * Smoke specs for the three games added in this batch: Texas Hold'em,
 * Slots, and Roulette. Each test creates a room of that game, starts a
 * hand, and verifies the appropriate UI surface renders. Not exhaustive
 * gameplay coverage — that's per-engine vitest specs' job.
 */

async function createRoomOf(
  page: Page,
  gameType: 'holdem' | 'slots' | 'roulette',
  name: string,
  seats: number,
) {
  await page.goto('/');
  await page.getByRole('button', { name: /\+ Create game/i }).click();
  const dialog = page.getByRole('dialog', { name: /Create a game/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Name/i).fill(name);
  await dialog.getByLabel(/Game/i).selectOption(gameType);
  await dialog.getByLabel(/Players \(excluding dealer\)/i).fill(String(seats));
  await dialog.getByRole('button', { name: /^Create$/i }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]+/);
}

test.describe('New games', () => {
  test("Hold'em: create + start hand renders preflop UI", async ({ authedPage }) => {
    await createRoomOf(authedPage, 'holdem', `e2e-holdem-${Date.now()}`, 3);
    await authedPage.getByRole('button', { name: /Start Hand/i }).click();
    // Pre-flop badge in the phase indicator. Hold'em-specific.
    await expect(authedPage.getByText(/Pre-flop/i).first()).toBeVisible({ timeout: 5_000 });
    // Action area renders fold/check/call/bet/raise buttons.
    await expect(authedPage.getByRole('button', { name: /^Fold$/i })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('Slots: create + start hand renders the bet form', async ({ authedPage }) => {
    await createRoomOf(authedPage, 'slots', `e2e-slots-${Date.now()}`, 1);
    await authedPage.getByRole('button', { name: /Start Hand/i }).click();
    // Spin button is the slots tell.
    await expect(authedPage.getByRole('button', { name: /^Spin$/i })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('Roulette: create + start hand shows the wheel + bet form', async ({ authedPage }) => {
    await createRoomOf(authedPage, 'roulette', `e2e-roulette-${Date.now()}`, 1);
    await authedPage.getByRole('button', { name: /Start Hand/i }).click();
    // Bet kind select is the roulette tell.
    await expect(authedPage.getByLabel(/^Bet$/i)).toBeVisible({ timeout: 5_000 });
    await expect(authedPage.getByRole('button', { name: /Place/i })).toBeVisible();
  });
});
