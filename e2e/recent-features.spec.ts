import { test, expect, type Page } from './fixtures';

/**
 * Coverage for features added since the original e2e batch:
 *   - Room name reuse after archive (partial unique index).
 *   - Turn timer renders on the seat that's on the clock.
 *   - Roulette spin button is creator-only at the UI level.
 *
 * Timeout-based behaviors (auto-fold, sit-out flow) live in their own
 * spec file once TURN_DURATION_MS becomes env-overridable for fast runs.
 */

async function createRoom(
  page: Page,
  opts: { name: string; game?: string; seats?: number },
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /\+ Create game/i }).click();
  const dialog = page.getByRole('dialog', { name: /Create a game/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Name/i).fill(opts.name);
  if (opts.game) {
    await dialog.getByLabel(/^Game$/i).selectOption(opts.game);
  }
  if (opts.seats) {
    await dialog.getByLabel(/Players \(excluding dealer\)/i).fill(String(opts.seats));
  }
  await dialog.getByRole('button', { name: /^Create$/i }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]+/);
}

test.describe('Room name partial unique', () => {
  test('archived room releases its name for reuse', async ({ authedPage }) => {
    const roomName = `e2e-reuse-${Date.now()}`;
    await createRoom(authedPage, { name: roomName });

    // The Close-room button uses a JS `confirm()` — accept it.
    authedPage.on('dialog', (d) => d.accept());
    await authedPage.getByRole('button', { name: /Close room/i }).click();
    await authedPage.waitForURL(/\/$/);

    // Creating again with the same name should not 409.
    await createRoom(authedPage, { name: roomName });
    await expect(authedPage.getByRole('heading', { name: roomName })).toBeVisible();
  });
});

test.describe('Turn timer', () => {
  test("Hold'em: the seat on the clock shows a countdown timer", async ({ authedPage }) => {
    const roomName = `e2e-timer-${Date.now()}`;
    // Hold'em needs 2+ seats; the AI fills the other position.
    await createRoom(authedPage, { name: roomName, game: 'holdem', seats: 2 });

    await authedPage.getByRole('button', { name: /Start Hand/i }).click();

    // The viewer's seat (heads-up Hold'em: viewer is SB or BB; either way
    // they end up on the clock after at most one AI action) shows the
    // TurnTimer with role="timer" and an Ns text content.
    const timer = authedPage.getByRole('timer');
    await expect(timer).toBeVisible({ timeout: 10_000 });
    await expect(timer).toHaveText(/^\d+s$/);
  });
});

test.describe('Roulette UI gating', () => {
  test('creator sees the Spin button when bets are placed', async ({ authedPage }) => {
    const roomName = `e2e-roulette-${Date.now()}`;
    await createRoom(authedPage, { name: roomName, game: 'roulette', seats: 1 });

    await authedPage.getByRole('button', { name: /Start Hand/i }).click();

    // The wheel renders; the spin button shows up once we're in the
    // awaiting_bets phase. Server still requires at least one bet on the
    // table before settling, but the button is always visible for the
    // creator.
    await expect(authedPage.getByRole('button', { name: /Spin the Wheel/i })).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('Seat count change', () => {
  test('creator can raise the seat count on a blackjack room', async ({ authedPage }) => {
    const roomName = `e2e-seats-${Date.now()}`;
    await createRoom(authedPage, { name: roomName, seats: 3 });

    // Before: lobby header says "3 seats".
    await expect(authedPage.getByText(/3 seats/i).first()).toBeVisible();

    // Change via the SeatSwitcher input + Save.
    await authedPage.getByLabel(/^Seats$/i).fill('5');
    await authedPage.getByRole('button', { name: /^Save$/i }).click();

    // After: lobby header says "5 seats".
    await expect(authedPage.getByText(/5 seats/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('reducing seats triggers a confirm prompt', async ({ authedPage }) => {
    const roomName = `e2e-reduce-${Date.now()}`;
    await createRoom(authedPage, { name: roomName, seats: 4 });

    // Accept whatever confirm() fires; record its text to assert on.
    let prompt: string | null = null;
    authedPage.on('dialog', (d) => {
      prompt = d.message();
      void d.accept();
    });

    await authedPage.getByLabel(/^Seats$/i).fill('2');
    await authedPage.getByRole('button', { name: /^Save$/i }).click();

    await expect(authedPage.getByText(/2 seats/i).first()).toBeVisible({ timeout: 5_000 });
    expect(prompt).toMatch(/Reduce seats from 4 to 2/i);
  });

  test('slots rooms have a read-only seats label, not an input', async ({ authedPage }) => {
    const roomName = `e2e-slots-seats-${Date.now()}`;
    await createRoom(authedPage, { name: roomName, game: 'slots', seats: 1 });

    // The header still surfaces the count.
    await expect(authedPage.getByText(/1 seats/i).first()).toBeVisible();
    // And the read-only chip explicitly says the count is locked.
    await expect(authedPage.getByText(/fixed for slots/i)).toBeVisible();
    // The editable seats input shouldn't render at all.
    await expect(authedPage.getByLabel(/^Seats$/i)).toHaveCount(0);
  });
});

test.describe('Kick seat', () => {
  test('creator removes a joined non-creator from the roster', async ({ browser, authedPage }) => {
    const roomName = `e2e-kick-${Date.now()}`;
    await createRoom(authedPage, { name: roomName, seats: 3 });

    // Grab the join URL the creator can share.
    const joinPath = await authedPage.getByLabel(/Join URL/i).inputValue();
    expect(joinPath).toMatch(/^\/join\//);

    // Second user joins in a fresh browser context (separate cookie jar).
    const bContext = await browser.newContext();
    try {
      const bPage = await bContext.newPage();
      const bName = `e2e-kick-victim-${Date.now()}`;
      const loginResp = await bPage.context().request.post('/test-auth/login', {
        form: { name: bName },
      });
      expect(loginResp.ok()).toBeTruthy();

      // Visit the join URL — backend creates a pending invitation and
      // redirects to /. Accept it there; wait for B's redirect to the
      // room view so the seat commit is observable before A reloads.
      await bPage.goto(joinPath);
      await bPage.waitForURL(/\/$/, { timeout: 5_000 });
      await bPage
        .getByRole('button', { name: /^Accept$/i })
        .first()
        .click();
      await bPage.waitForURL(/\/rooms\//, { timeout: 5_000 });

      // Now the second user has a seat. Refresh A's room to see them.
      await authedPage.reload();
      await expect(authedPage.getByText(bName)).toBeVisible({ timeout: 5_000 });

      // Kick: accept the confirm and click the ✕ on the second user's row.
      authedPage.on('dialog', (d) => void d.accept());
      await authedPage.getByRole('button', { name: new RegExp(`Remove ${bName}`, 'i') }).click();

      // The second user's row should disappear from the roster.
      await expect(authedPage.getByText(bName)).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await bContext.close();
    }
  });
});

test.describe("Turn timeout (Hold'em)", () => {
  // Relies on playwright.config.ts setting TURN_DURATION_MS=2000 in the
  // dev-server env so the fold fires in ~2 seconds instead of 30.

  test('creator who times out is auto-folded but does not sit out', async ({ authedPage }) => {
    const roomName = `e2e-creator-timeout-${Date.now()}`;
    await createRoom(authedPage, { name: roomName, game: 'holdem', seats: 2 });
    await authedPage.getByRole('button', { name: /Start Hand/i }).click();

    // Wait for the viewer's timer to appear (they become to-act after
    // the AI cascade lands).
    await expect(authedPage.getByRole('timer')).toBeVisible({ timeout: 10_000 });

    // Don't act — let the 2s clock expire. SSE will push the auto-fold
    // event; the hand goes terminal (heads-up: AI wins by walkover).
    await expect(authedPage.getByText(/Hand complete/i)).toBeVisible({ timeout: 10_000 });

    // Creator is exempt from sit-out — the banner must NOT appear.
    await expect(authedPage.getByText(/You're sitting out/i)).toHaveCount(0);
  });
});

test.describe('Turn timeout (5-Card Draw)', () => {
  // Same TURN_DURATION_MS=2000 override.

  test('creator who times out is auto-folded but does not sit out', async ({ authedPage }) => {
    const roomName = `e2e-poker-creator-timeout-${Date.now()}`;
    // 5cd requires 2+ seats.
    await createRoom(authedPage, { name: roomName, game: 'poker', seats: 2 });
    await authedPage.getByRole('button', { name: /Start Hand/i }).click();

    await expect(authedPage.getByRole('timer')).toBeVisible({ timeout: 10_000 });

    // Auto-fold lands; heads-up means the AI wins by walkover and the
    // hand reaches `settled` (label: "Hand complete").
    await expect(authedPage.getByText(/Hand complete/i)).toBeVisible({ timeout: 10_000 });

    // Creator is exempt from sit-out.
    await expect(authedPage.getByText(/You're sitting out/i)).toHaveCount(0);
  });
});

test.describe('Rate limiting', () => {
  test('chat send limit: 5 messages within 10s, 6th rejected', async ({ authedPage }) => {
    const roomName = `e2e-chat-rl-${Date.now()}`;
    await createRoom(authedPage, { name: roomName });

    const chat = authedPage.getByRole('complementary', { name: /Room chat/i });
    await expect(chat).toBeVisible();

    const input = chat.getByLabel(/Chat message/i);
    const sendBtn = chat.getByRole('button', { name: /Send/i });

    // Send the first 5 — each one clears the input on success, which is
    // a reliable signal the previous submit landed (the SSE delivery and
    // the fetcher-idle effect race otherwise).
    for (let i = 1; i <= 5; i++) {
      await input.fill(`msg ${i}`);
      await sendBtn.click();
      await expect(input).toHaveValue('', { timeout: 3_000 });
      await expect(chat.getByText(`msg ${i}`)).toBeVisible({ timeout: 3_000 });
    }

    // The 6th submission should be rejected by the server (HTTP 429).
    // The input clears only on `ok: true` — a failed submit keeps the
    // draft, so the message body stays in the input and never lands in
    // the chat log.
    await input.fill('msg 6 BLOCKED');
    await sendBtn.click();

    await authedPage.waitForTimeout(1_500);
    await expect(chat.getByText('msg 6 BLOCKED')).toHaveCount(0);
  });
});

test.describe('Turn timeout (Blackjack)', () => {
  // Same TURN_DURATION_MS=2000 override.

  test('creator who times out is auto-played but does not sit out', async ({ authedPage }) => {
    const roomName = `e2e-bj-creator-timeout-${Date.now()}`;
    await createRoom(authedPage, { name: roomName, game: 'blackjack', seats: 2 });
    await authedPage.getByRole('button', { name: /Start Hand/i }).click();

    // Blackjack can timeout twice in one hand (awaiting_bets → playing),
    // so we give a generous deadline for the hand to settle.
    await expect(authedPage.getByText(/Hand complete/i)).toBeVisible({ timeout: 15_000 });

    // Creator is exempt from sit-out — banner must not appear.
    await expect(authedPage.getByText(/You're sitting out/i)).toHaveCount(0);
  });
});
