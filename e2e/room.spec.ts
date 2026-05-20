import { test, expect, type Page } from './fixtures';

/**
 * Helper: open the Create Game modal and submit it with the given name +
 * (default) blackjack / 1-seat / low stakes settings. Lands on /rooms/:id.
 */
async function createRoom(page: Page, roomName: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /\+ Create game/i }).click();
  const dialog = page.getByRole('dialog', { name: /Create a game/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Name/i).fill(roomName);
  // Defaults are fine for the smoke test (Blackjack, 3 seats, low stakes).
  await dialog.getByRole('button', { name: /^Create$/i }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]+/);
}

test.describe('Room creation', () => {
  test('creator lands on the room page with the chosen name visible', async ({ authedPage }) => {
    const roomName = `e2e-room-${Date.now()}`;
    await createRoom(authedPage, roomName);
    // Page title block includes name · current game.
    await expect(authedPage.getByRole('heading', { name: roomName })).toBeVisible();
    await expect(authedPage.getByText(/Blackjack/i).first()).toBeVisible();
  });

  test('chat: sending a message renders it back in the pane', async ({
    authedPage,
    freshUserName,
  }) => {
    const roomName = `e2e-chat-${Date.now()}`;
    await createRoom(authedPage, roomName);

    const chat = authedPage.getByRole('complementary', { name: /Room chat/i });
    await expect(chat).toBeVisible();

    const message = `hello from ${freshUserName}`;
    await chat.getByLabel(/Chat message/i).fill(message);
    await chat.getByRole('button', { name: /Send/i }).click();

    // Own messages are labeled "You" and the body appears in the log.
    await expect(chat.getByText(message)).toBeVisible({ timeout: 5_000 });
    await expect(chat.getByText('You')).toBeVisible();
  });

  test('Start Hand from the lobby renders the blackjack hand UI', async ({ authedPage }) => {
    const roomName = `e2e-start-${Date.now()}`;
    await createRoom(authedPage, roomName);

    await authedPage.getByRole('button', { name: /Start Hand/i }).click();
    // After the redirect the viewer sees the BetForm (their seat is
    // awaiting an initial bet) and the dealer section.
    await expect(authedPage.getByRole('button', { name: /place bet/i })).toBeVisible({
      timeout: 5_000,
    });
    await expect(authedPage.getByRole('heading', { name: /Dealer/i })).toBeVisible();
  });

  test('switching games from the lobby auto-starts a hand of the new type', async ({
    authedPage,
  }) => {
    // Need 2+ seats so the switcher allows poker.
    const roomName = `e2e-switch-${Date.now()}`;
    await authedPage.goto('/');
    await authedPage.getByRole('button', { name: /\+ Create game/i }).click();
    const dialog = authedPage.getByRole('dialog', { name: /Create a game/i });
    await dialog.getByLabel(/Name/i).fill(roomName);
    // Bump seats to 3 so poker is eligible.
    await dialog.getByLabel(/Players \(excluding dealer\)/i).fill('3');
    await dialog.getByRole('button', { name: /^Create$/i }).click();
    await authedPage.waitForURL(/\/rooms\/[0-9a-f-]+/);

    // In the lobby, swap the game to poker via the GameSwitcher form.
    await authedPage.getByLabel(/^Game$/i).selectOption('poker');
    await authedPage.getByRole('button', { name: /^Switch$/i }).click();

    // Auto-start kicks in: the page now shows the poker phase badge and
    // pot indicator instead of the blackjack BetForm.
    await expect(authedPage.getByText(/5-Card Draw/i).first()).toBeVisible({ timeout: 5_000 });
    await expect(authedPage.getByText(/Pot:/i)).toBeVisible({ timeout: 5_000 });
  });
});
