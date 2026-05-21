# TODO

Actionable items from the architecture and best-practices review.
Roughly ordered by ROI within each section.

> **Current focus (2026-05-21):** Five games live with turn timeouts
> (30s clock, auto-fold in poker games, auto-stay in blackjack),
> auto-fold-then-sit-out flow for Hold'em (creator exempted), advisory
> locks across all but slots, partial-unique room names, and creator-
> only enforcement on roulette spin. Three audits just landed (e2e
> coverage, a11y, security) — findings are listed below as actionable
> items, ordered by severity within each section. The big unresolved
> work is rate limiting, Zod schemas for the four non-blackjack engines,
> and the modal-focus-trap a11y gap.

## Recently shipped (since last TODO update)

- [x] **Player turn timeouts.** 30s clock per human turn (`TURN_DURATION_MS`); engine state carries `turnDeadlineAt`; in-process scheduler arms a timer per hand; fires through `engine.aiAction`-style auto-actions while serialized by `pg_advisory_xact_lock(handId)`. Boot reconciliation walks unsettled hands on `entry.server` and re-arms / fires-now as appropriate. `useCountdown` + `<TurnTimer>` flash red < 5s on the client. Tests: `turnDeadlineService.spec.ts`.
- [x] **Game-specific timeout auto-actions.** Hold'em hard-folds; 5cd folds in betting rounds and stands pat (`discard []`) during the draw phase; blackjack picks `stay` when legal, falls back to engine.aiAction in `awaiting_bets` / `insurance_offered`.
- [x] **AI cascade at hand start.** When the first to act after blinds (Hold'em) / ante (5cd) is an AI seat, the start tx now cascades AI turns through to a human or terminal so the table never deadlocks on an AI prefix.
- [x] **Sit-out flow (Hold'em).** New `seat.sitting_out boolean` (migration `20260524000000`). Hold'em timeout fires set the flag; `tableLifecycle.startHand` filters out sitting-out seats so their position becomes an AI fill; "Rejoin next hand" banner in the Hold'em hand view + roster chip + button in the lobby. Room creator is exempt (parking the creator deadlocks the flow since only they can start hands).
- [x] **Roulette race + spin authz.** `submitRouletteAction` now acquires `pg_advisory_xact_lock(handId)` and re-reads state under the lock; the route action enforces `room.created_by === user.id` for `spin` (the UI button was already hidden but the server didn't check). Closes the place_bet/spin interleave + the hand-crafted-POST bypass.
- [x] **Advisory-lock helper fix.** `pg_advisory_xact_lock` returns `void`, so `$queryRawUnsafe` was crashing with a deserialization error — switched to `$executeRawUnsafe` across all engines.
- [x] **Room name partial unique.** Replaced the `(created_by, name)` unique with a partial index `WHERE archived_at IS NULL` (migration `20260525000000_room_name_partial_unique`, raw SQL — Prisma's `@@unique` doesn't take a WHERE clause; schema.prisma documents this). Archived rooms now release their name back to the creator.
- [x] **CI: `.npmrc` with `legacy-peer-deps`.** `remix-utils@7.7` peer-deps zod@3 but the project uses zod@4; the lockfile was already resolved under legacy-peer-deps locally. Real fix is upgrading remix-utils to 9.x (drops zod peer dep), which requires React Router 7 — its own project (see "Deferred — major-version migrations").

## Critical correctness bugs

- [x] **Deck is missing 10s.** `app/lib/Card/index.ts:6` — add `'10'` to the `ranks` array. Every blackjack game is currently played with a 48-card deck. _(Done — task #2; covered by `Deck.spec.ts`.)_
- [x] **`forEach` with `async` callback skips awaits.** `app/actions/game.ts:164` — replace with `for (const game_player of game.game_player) { await dealToPlayer(...) }`. Without this, `dealToDealer` and the rest of `startGame` run before player deals finish. _(Done — task #2.)_
- [x] **Query escapes the transaction.** `app/actions/game.ts:171` — `getGameById(game?.id || '')` runs inside `prisma.$transaction` without passing `tx`. Pass `tx` so the re-read sees in-flight writes. _(Done — task #2.)_
- [x] **Misleading comment on debit path.** `app/actions/game.ts:182-185` — comment claims money is already debited at bet time, but it isn't (no debit in `placeInitialBet`). Either remove the comment or rewrite it to match reality. _(Done — task #2.)_
- [x] **Blackjack split crash on next action.** `app/actions/handEngine.server.ts:156` — `buildUserMap` was being passed split-sibling slot ids (`${parentId}:split:N`) which aren't valid UUIDs, breaking Prisma's `where: { id: { in: [...] } }`. Fixed by filtering to slots with `parentSlotId == null` — `ownerOf` already resolves split siblings via the parent. _(Pre-existing bug surfaced during CSRF testing.)_

## Security

- [x] **No authentication.** Was: `findOrCreateUserByName` created users by name only with no password check. **Now:** Google OAuth via `remix-auth` + `remix-auth-google`, with `oauth_identity` table, session storage, and an extensible provider registry in `app/auth/providers.server.ts`. _(Done — task #3.)_
- [x] **URL-based authorization.** `/game/$gamePlayerId` lets anyone with the UUID control that seat. **Now:** `requireSeat(request, gamePlayerId)` in `app/auth/guards.server.ts` enforces `game_player.user_id === sessionUser.id`. _(Done — task #3.)_
- [x] **No bet validation.** `placeInitialBet` now validates `amount > 0` (positive integer), `amount <= gamePlayer.user.money`, and `minimumBet <= amount <= maximumBet`. Hard safety net: the atomic `UPDATE user SET money = money + delta WHERE money >= minRequired` in `recordMoneyTransaction` rejects any insufficient-funds debit. _(Done — task #4.)_
- [x] **CSRF protection** on `<Form method="post">` flows. `remix-utils/csrf` wired in via `app/auth/csrf.server.ts` (signed cookie + signed-token validate). `app/root.tsx` loader commits a token and wraps children in `<AuthenticityTokenProvider>`; every form across `_index.tsx` and the form-rendering components includes `<AuthenticityTokenInput />`; every action route (`_index.tsx`, `rooms.$roomId.tsx`, `auth.$provider.tsx`, `auth.logout.tsx`) calls `csrf.validate(...)` and returns 403 on `CSRFError`.

### Findings from the 2026-05-21 security audit

Threat model: ordinary players who would cheat or grief if they could (not nation-state). Real money not yet involved. Audit covered authz, IDOR, action injection, money manipulation, state tampering, race conditions, XSS, session security, rate limiting, CSRF, test-auth bypass, SQL injection. No critical authorization gaps found beyond what's already been fixed.

- [x] **(CRITICAL) Slots missing advisory lock.** Fixed — `submitSlotsAction` now acquires `pg_advisory_xact_lock(handId)` and re-reads state under the lock, same pattern as the other four engines.
- [x] **(HIGH) Zod schemas missing for 4 of 5 engines.** Fixed — `FiveCardDrawStateSchema`, `HoldemStateSchema`, `SlotsStateSchema`, `RouletteStateSchema` now live in `state.schema.ts` next to each engine's `types.ts`. Shared `ActorStatusSchema` / `HandRankSchema` in `engines/poker/shared/schemas.ts`. Every `parseState` now `.parse()`s the row instead of casting.
- [ ] **(HIGH) Rate limiting missing on chat / actions / room create / invitation accept.** `chat.server.ts` accepts unlimited messages per user; the room action handler accepts unlimited action submits per second; `_index.tsx` lets a user create rooms without throttle. **Fix:** simplest — per-user per-route token bucket in memory (move to Redis when we go multi-instance). Pick thresholds together when the user is back.
- [ ] **(MEDIUM) No concurrent-seat cap per user.** Nothing prevents a user from accepting invitations into thousands of rooms and hoarding seats forever. **Fix:** check seat count in `acceptInvitation` and refuse above a threshold (50? 100?).
- [x] **(LOW) Idempotency keys not used on settlement.** Fixed — every settle path (blackjack main + insurance, 5cd submit + timeout, Hold'em submit + timeout, roulette spin, slots) now passes `idempotencyKey: \`settle:${slotId}\`` (slot ids are UUIDs minted per hand, no collisions). A retried settle returns the existing row instead of double-crediting.
- [ ] **(LOW) Session revocation.** Sessions are cookie-only; a leaked cookie lives 30 days. If/when we add a session table, check it on every request. Acceptable for friends-only play.

## Multiplayer + game variety

- [x] **Multiplayer rooms.** `casino_table` is now a persistent room with `name`, `join_token`, `max_seats`, `created_by`. Roster lives in `seat` rows; hands live in `hand` rows. Room-centric URLs (`/rooms/$roomId`). _(Done in earlier sprint; commit 1fd0ce6.)_
- [x] **Room naming.** `casino_table.name VARCHAR(128) NOT NULL`, unique per creator. Migration backfills existing rows. Surfaced in landing page room list, in-room header, and invitation list. `CreateGameModal` requires it.
- [x] **Invitations + join tokens.** `table_invitation` row per (room, user). Pending/accepted/declined lifecycle. Shareable `/join/$token` URL upserts a pending invite or sends already-seated users straight in.
- [x] **AI auto-fill.** Empty seats are filled with bot users when a hand starts. Bots are **ephemeral per hand** — `getAvailableAIUsers(n)` mints fresh `user` rows on every call with names picked from `AI_NAMES` (Fisher-Yates without repetition). No pool, no "busy" tracking, no exhaustion. Old bot rows stay as dead data; could be GC'd periodically once the table grows. _(Earlier sprint commits 836a301, 3ba6616 introduced the pool; later commit 4390258 replaced it with the ephemeral strategy after the pool kept running out under e2e load.)_
- [x] **Game switching mid-room.** Creator-only `switchRoomGame` action (`app/actions/tableLifecycle.server.ts`) validates seat-count compatibility against the new game's `GAME_SEAT_RANGES`. Submit triggers an immediate `startHand` of the new game so the table doesn't sit idle. `GameSwitcher` renders inline (read-only label for non-creators).
- [x] **Real-time chat.** Persisted `chat_message` table (cascade-deleted with room); `chatBus` (room-keyed `EventBus`) layers realtime delivery on top. SSE `/rooms/$roomId/events` forwards `chat_message` events. `ChatPane` does an initial-scrollback render from the loader, merges incoming SSE messages by id, auto-scrolls; composer is a textarea with Enter-to-send / Shift+Enter newline. Layout is a two-pane grid (chat on the right at lg+, stacked below on mobile).
- [x] **Avatar component.** Deterministic initials + name-hashed HSL color (`app/components/Avatar.tsx`). AI seats get a gear glyph + neutral gray so bots are visually distinct.
- [x] **Wide-row seats.** `PokerSeat` and `PlayerSection` use a shared structural type and one full-width-row layout: avatar + identity + status + cards filling the negative space + total/rank on the right. Used by blackjack, 5-card draw, and Texas Hold'em.
- [x] **Five games live.**
  - Blackjack (`engines/blackjack/`) — all four standard rules (hit/stay/double/surrender/split/insurance), multi-seat, AI participation.
  - 5-Card Draw (`engines/poker/fiveCardDraw/`) — antes, two betting rounds, draw phase, showdown via shared hand-eval.
  - Texas Hold'em (`engines/poker/holdem/`) — small/big blinds, BB option enforced via `hasActedThisRound`, four streets (preflop → flop → turn → river), best-5-of-7 showdown via shared `bestHandFrom`, fast-forward to showdown when only one player can still bet. Dealer button currently fixed at seat 0 (see backlog).
  - Slots (`engines/slots/`) — single-seat, 3 reels of 5 symbols, three-of-a-kind + two-sevens payouts.
  - Roulette (`engines/roulette/`) — European single-zero (0-36), 13 bet kinds (straight + 12 outside), multi-player. Standard rectangular betting felt rendered as a clickable grid (0 + 3×12 numbers + 2:1 column triggers + dozens + outside-bet row). "Your bets" panel inside the form lists existing wagers with colored swatches so the user doesn't accidentally double-bet.
- [x] **E2E tests.** Playwright + chromium. `e2e/global-setup.ts` bootstraps an isolated `db_webcasino_test` database (create-if-missing, `prisma migrate deploy`, truncate-all) on every run, and `webServer.env` passes `PORT=5274`, `DATABASE_URL=...test...`, `E2E_AUTH_BYPASS=1` to a freshly-spawned dev server so it can coexist with a developer's local `npm run dev` on 5273. `vite.config.ts` reads `PORT` from env to support this. A test-only `/test-auth/login` route (refuses unless `E2E_AUTH_BYPASS=1` AND `NODE_ENV !== 'production'`) lets the auth fixture skip Google OAuth. Nine specs across `landing.spec.ts`, `room.spec.ts`, and `new-games.spec.ts`. Runs in ~10s locally via `npm run e2e`; idempotent across repeated runs (no state pollution).
- [x] **Room archival.** Creator-only soft-delete via `archiveRoom` in `tableLifecycle.server.ts` — refuses mid-hand, sets `casino_table.archived_at = now()`. Hidden from `listUserRooms`, `listUserInvitations`, `joinViaToken`, `acceptInvitation`, `startHand`, `switchRoomGame`, the room loader (redirects to landing), and the SSE events route. Historical hand/chat/transaction data is preserved. Small "✕ Close room" button in the room header (creator-only, JS confirm prompt). Future "show archived" toggle would relax the `archived_at IS NULL` filter on the list queries.

### Open backlog from this batch

- [x] **Hold'em dealer button rotation.** `HoldemConfig.dealerIdx` (optional) threads through `startHoldemHand` to `engine.initialState`. `tableLifecycle.startHand` reads the previous Hold'em hand's `dealerIdx` from `hand.data` and passes `(prev + 1) % participants.length`. Resets to 0 if the most recent hand at the room isn't Hold'em. Covered by `engine.spec.ts`.
- [x] **Slots / roulette views subscribe to SSE.** `useSlotsView` + `useRouletteView` hooks parallel the other game views; both views now consume `view, status` and render a `ConnectionStatus`. Multi-player roulette gets live "X placed a bet" updates without manual refresh.
- [x] **Roulette wheel spin animation.** Same strip-translates-downward pattern as slots but framed in the circular wheel window (41 cells × 7.5rem, 2.4s with long-tail ease). New `wheel-spin-down` keyframe in `tailwind.css`.
- [x] **Room title bar showed "BLACKJACK" for every non-poker game.** Stale ternary in `rooms.$roomId.tsx` replaced with a `GAME_LABEL` map covering all five games.
- [ ] **Roulette: more bet types.** Corners, streets, splits, six-line. Engine extension point is `BetKind` + `isWinningBet`; UI extension is straightforward now that the board is a CSS grid (an intersection between number cells = corner, edge between adjacent rows = split, etc.). Out of scope for v1.
- [ ] **Show-archived-rooms toggle.** Soft delete is live; surfacing the archived list is just a query filter relax and a UI checkbox on the landing page. Useful once someone wants to "reopen" a room (would also need an unarchive action).
- [ ] **Hold'em AI is passive.** Calls pair-or-better, never raises. Same passive policy as 5-card draw. Plays for engagement, not strength. Tighten with pot odds + hand-strength tiers + occasional aggression once we have a feel for table dynamics.
- [ ] **Poker engine code dedup.** 5-card draw and Hold'em both inline `freshDeck`/`shuffle`/`draw`/`deepClone`/`advanceWithinRound`/`endBettingRound`. Extract into `engines/poker/shared/` once both engines have settled.
- [ ] **Animation primitives dedup.** Slots and roulette both use the strip-translates-downward pattern with separate keyframes (`reel-spin-down`, `wheel-spin-down`) and parallel component scaffolding. Extract a reusable `<SpinningStrip>` once a third caller appears.
- [ ] **Periodic AI bot GC.** With ephemeral bots, old `is_ai: true` user rows accumulate forever. Cost is trivial today but a small cron / startup task could prune AI users whose only relations are to settled hands older than N days.
- [ ] **Theme / color customization for rooms.** User-requested follow-up after room naming. Per-room color palette (felt color, accent), shown in the room header + chat. Schema: nullable `theme JSON` column or a small `room_theme` table.

## Accessibility

- [x] **Win-banner contrast on yellow.** GameSwitcher's "Game: X" label and the "Start Next Hand / Round / Spin Again" button both inherited / used colors that washed out against the yellow win background (white-on-yellow, yellow-on-yellow). GameSwitcher now accepts a `tone: 'dark' | 'light'` prop; banners pass `tone="light"` when in the winning state and switch the Start button from `primary` (yellow) to `success` (green). Fix applied across all five game banners (blackjack OutcomeBanner, PokerOutcomeBanner, HoldemOutcomeBanner, RouletteHandView SettledPanel, SlotsHandView OutcomePanel).
- [x] **Tone-aware focus rings.** `buttonClass` now accepts a `tone?: 'dark' | 'light'` parameter. The five win-banner Start buttons (OutcomeBanner, PokerOutcomeBanner, HoldemOutcomeBanner, RouletteHandView SettledPanel, SlotsHandView SpinAgain) pass `tone="light"` when the banner background is yellow → slate-900 focus ring on yellow-300 offset, fully visible.
- [x] **Comprehensive a11y review** (manual code-walk, 2026-05-21). Findings below by severity. Axe-core / Lighthouse run still TODO once a CI a11y job exists.

### Findings from the 2026-05-21 a11y review

- [ ] **(HIGH) Modal focus trap missing.** `CreateGameModal.tsx:25-251` has ESC handler + backdrop click but no focus trap; keyboard can tab into the page behind it, and focus restoration on close isn't explicit. **Fix:** use the native `<dialog>` element (browser handles the trap + ESC + return) or `react-focus-on`.
- [x] **(HIGH) Yellow win banner has invisible focus ring.** Fixed — `buttonClass` now takes `tone: 'dark' | 'light'`. All five win-banner Start buttons opt in to the light tone (slate-900 ring on yellow-300 offset).
- [ ] **(HIGH) Amber sit-out button contrast borderline.** `bg-amber-500 text-slate-900` on `bg-amber-900/40` banner background. Test ratio; if it fails WCAG AA, darken the button or border the banner.
- [x] **(MEDIUM) Turn timer aria-label doesn't update each tick.** No-op — the audit misread the file. `TurnTimer.tsx:24` already uses a dynamic label (`${seconds} seconds until auto-fold`), and the live region's text content (`{seconds}s`) re-announces on every tick.
- [x] **(MEDIUM) Roulette board buttons missing `aria-label`.** Fixed — every BoardCell, NumberRow cell, and the 0 button now has an `aria-label` that names the bet kind, the number, the color (where relevant), and the payout (e.g., "Straight bet on 17 (red)", "Red bet — pays 1:1").
- [x] **(MEDIUM) Sit-out state changes not announced.** Fixed — Hold'em's `SittingOutBanner` now has `role="status" aria-live="polite"`. (Lobby roster chip is fine — it's static text already in the SR reading order.)
- [ ] **(MEDIUM) Heading hierarchy broken.** Pages have no `h1`; seat rows mix `h2` (PlayerSection) and `h3` (PokerSeat, RouletteHandView). **Fix:** add an h1 to each game's hand view, demote seats to h3 consistently.
- [ ] **(MEDIUM) Chat timestamps inaccessible.** `ChatPane.tsx:129-136` defers the time until hydration, leaving SR with empty text pre-hydrate. Also only `title` is set, no `aria-label`. **Fix:** always render a text node (ISO fallback OK), add `aria-label="Sent at HH:MM"` to the `<time>`.
- [ ] **(LOW) Avatar gear-glyph clarity.** AI seats render `⚙` with `aria-hidden`; SR relies on the parent label including "(bot)". Verify all callsites label correctly. Optionally add a visible "(AI)" suffix on player rows.
- [x] **(LOW) Bet-amount inputs need `aria-describedby`.** Done — roulette + slots inputs now reference `id`'d constraint paragraphs. Poker bet/raise inputs don't have visible constraint text (constraints live as `min`/`max` attrs); skipped.

## Type safety & data model

- [x] **Replace `as unknown as` casts with runtime validation.** `app/lib/gameState.ts` defines `BlackjackStateSchema`, `GamePlayerStateSchema`, and a `GameStateSchema` discriminated union; `parseBlackjackState()` / `parseGamePlayerState()` validate at every read site across `actions/`, `routes/`, and `components/`. `Card.suit` and `Card.rank` narrowed to enum types so structural compatibility holds. Schema specs added in `gameState.spec.ts`. Remaining `as unknown as` sites are limited to Prisma's `JsonObject` write typing and the remix-auth Strategy interface cast. _(Done — task #5.)_
- [x] **Lift stringly-typed enums to TS string literal unions.** The blackjack engine (`app/engines/blackjack/`) now uses discriminated-union `BlackjackAction` (`'place_bet' | 'hit' | 'stay' | 'double_down' | 'surrender' | 'dealer_play' | 'deal_initial'`) and a tight `PlayerStatus` union. Money transaction type narrowed to `'debit' | 'credit'` in `recordMoneyTransaction`. _(Done — task #6.)_
- [x] **Reconcile schema source-of-truth.** Adopted Prisma Migrate. `prisma/schema.prisma` is the sole source of truth; baseline + `multiplayer_invites` + `chat_messages` + `room_name_and_game_switch` + `room_archived_at` migrations applied. Container entrypoint runs `prisma migrate deploy` before app start.
- [x] **Make `updated_at` automatic.** All `updated_at` columns in `schema.prisma` carry `@updatedAt`; the client maintains the timestamp on every UPDATE.
- [ ] **Move deck out of the JSON blob (longer-term).** Every hit/stay rewrites the entire deck array in `hand.data`. Consider deriving deck state from a seed + dealt-cards log, or a per-card table. Now applies to all five games' state blobs, not just blackjack.
- [ ] **Consider money in cents (longer-term).** `Math.floor(bet * 1.5)` already truncates on blackjack payouts; cents or `Decimal` would avoid this.
- [ ] **Zod schemas for the new engine states.** Blackjack has `BlackjackStateSchema`; 5cd / Hold'em / slots / roulette currently trust the engine wrote it and cast through `as unknown as`. Each new engine should add a schema spec alongside its `engine.spec.ts`.

## Architecture

- [x] **Singleton Prisma client.** All `app/actions/*` files now import `prisma` from `db.server`. `PrismaTransactionClient` type lives in `db.server.ts`. _(Done — task #4.)_
- [x] **Use `.server.ts` suffix for server-only modules.** All `app/actions/*.ts` are `*.server.ts` so Vite reliably tree-shakes them out of the client bundle. _(Done — task #4.)_
- [x] **Fix the import source in `routes/game.$gamePlayerId.tsx:2`.** _(Obsolete — the route no longer exists; the multiplayer rewrite replaced it with `rooms.$roomId.tsx`.)_
- [x] **Add `ErrorBoundary` exports** to routes so loader/action errors render gracefully instead of crashing. _(Done — `app/root.tsx` exports a global `ErrorBoundary`. Per-route boundaries can be added later if a route needs a more specific fallback.)_
- [x] **Reduce coupling between `game.ts` and `gamePlayer.ts`.** After engine integration (task #11), both files are reduced to read-only DTO type aliases. All state transitions live in `actions/handEngine.server.ts`. _(Done — task #11.)_
- [x] **Replace `window.open` resume flow** in `app/components/CasinoLanding/index.tsx`. _(Obsolete — the component was removed during the casino-areas rewrite, commit c0c114f.)_
- [x] **Generic `EventBus<T>`.** Hand events (per-handId) and chat (per-roomId) share `app/lib/eventBus.server.ts`; the old `BroadcastBus` is now just a typed instance. Adding a new pub/sub channel is one declaration + an instance.
- [ ] **Engine registry needs the new games.** `app/engines/registry.ts` currently only lists blackjack. 5-card draw, Hold'em, slots, and roulette are dispatched directly from `tableLifecycle.startHand` instead. Wire them through the registry so the dispatcher becomes data-driven.
- [ ] **SSR-safe rendering pass.** A few client-only constructs caused hydration mismatches mid-iteration (timezone-dependent timestamps in `ChatPane`, `window.location.origin` in `RoomLobby`). Both fixed locally — worth a one-time sweep for other `Date`/`window`/`Intl`/`Math.random` usages that end up in JSX.
- [ ] **Consolidate room-page SSE connections.** `useHandView`/`usePokerView`/`useHoldemView` each open their own `EventSource`, and `ChatPane` opens a third. Functional but wasteful. Lift into a single context provider keyed on `roomId`.

## Tooling & DX

- [x] **Add unit tests.** Vitest + fast-check. 222 specs across 17 files. Test file convention: `*.spec.ts`.
- [x] **Add E2E tests.** See "Multiplayer + game variety".
- [x] **Add CI.** `.github/workflows/ci.yml` runs `npm ci`, `typecheck`, `lint`, `format:check`, and `test` on push to main and on PRs.
- [x] **Add Prettier.** `.prettierrc.json` sets `singleQuote`, `trailingComma: 'all'`, `printWidth: 100`. `format:check` runs in CI.
- [x] **Multi-stage Dockerfile.** Four stages (`base`/`prod-deps`/`builder`/`runner`). Runner is alpine + `dumb-init`, runs as `node` user. Entrypoint runs `prisma migrate deploy` then `npm run start`.
- [x] **Move `prisma generate` out of `entrypoint.sh`** — handled by the `postinstall: prisma generate` hook at image build time.
- [x] **Expand `.dockerignore`.** Excludes `.git`, `.cache`, `build`, `.env(*)` (with `.env.example` allowlist), `*.md`, `.github`, IDE dirs, `coverage`, plus Playwright outputs.
- [x] **Decide on Node version.** All three sources pinned to Node 22.12.
- [ ] **Run e2e in CI.** Currently CI only runs unit tests. Wire `npm run e2e` into the workflow with a fresh Postgres service container (or per-job DB). Cleanup test users between runs.
- [ ] **Hide the seed.sql from the runtime image.** Belongs only in the Postgres init dir; doesn't need to ship in the app image.

### E2E coverage gaps from the 2026-05-21 audit

- [x] **Make `TURN_DURATION_MS` env-overridable.** Reads `process.env.TURN_DURATION_MS` (positive int) at module load; falls back to 30_000. Playwright config sets it to 2_000 so timeout specs run in seconds.
- [x] **Room name reuse after archive.** `e2e/recent-features.spec.ts` — create + archive + recreate succeeds.
- [x] **Turn timer renders.** Same spec file — Hold'em with 2 seats, assert `role="timer"` matches `/\d+s/`.
- [x] **Roulette UI gating: creator sees Spin.** Same spec file — basic positive test (full creator-only enforcement via hand-crafted POST still pending; needs a second user context).
- [x] **Hold'em creator never sits out on timeout.** Same spec file — uses the env override; the creator's auto-fold lands and `Hand complete` is shown without the sit-out banner appearing.
- [ ] **(M) Sit-out + rejoin flow (non-creator).** Needs a second authed user context (two `browser.newContext()` pairs sharing a room). Next batch.
- [ ] **(M) Roulette spin: server-side 403 for non-creators.** Same blocker — needs a second user that's joined the creator's room and submits a forged POST.
- [ ] **(L) 5cd phase-specific timeouts.** Betting-round timeout → fold; draw-phase timeout → stand pat. Needs poker-phase tracking helpers in the test harness.

## Production readiness

Infrastructure and operational work needed before this can be a live
product. Grouped by what's gated on the domain decision (build/deploy
wiring) versus what can land independently of hosting choices.

### Gated on domain + hosting choice

- [ ] **Register domain + DNS.** Drives every downstream choice (TLS, OAuth callback URLs, cookie domain).
- [ ] **Pick a host.** Fly.io / Railway / Render / AWS ECS / etc. Affects TLS story, secrets management, DB hosting, and the CI deploy step. Document the pick in `docs/INFRA.md`.
- [ ] **Container registry.** GHCR is the path-of-least-resistance with GitHub Actions; alternatives are ECR / Docker Hub. Pin a tagging convention (`sha-<commit>` + `main` floating).
- [ ] **Build-and-push CI job.** New `release` workflow (or job in `ci.yml`) that builds the Docker image and pushes to the registry on tag / on push-to-main, separate from the verify job. Skip cosign/SBOM in v1.
- [ ] **Deploy CI job.** Triggers the host's deploy hook (Fly: `flyctl deploy`; Render/Railway: webhook). Production deploys gated behind a `release-*` tag or a manual `workflow_dispatch`.
- [ ] **Staging environment.** A second `web` + DB instance behind a `staging.` subdomain, deployed from a `staging` branch or on every main push, so changes are exercised before prod.
- [ ] **TLS / HTTPS-only cookies.** Most hosts terminate TLS at their edge. Once we know the host: flip session cookie `secure: true`, `sameSite: 'lax'`, and the OAuth callback URLs to `https://`. Don't ship over plain HTTP in prod.

### Independent of hosting

- [x] **Healthcheck endpoint.** `/healthz` returns 200 + DB ping (or 503 + error message). JSON body so logs can show "what failed."
- [ ] **Graceful shutdown.** Trap `SIGTERM`, drain active SSE connections, close Prisma, exit. `dumb-init` is already in the Dockerfile to forward the signal; the app side still needs the handler.
- [ ] **Structured logs.** Replace `console.*` with `pino` (or similar) emitting JSON. Per-request log includes `req_id`, `user_id`, `route`, `latency_ms`. Required for shipping to a log aggregator.
- [ ] **Error reporting.** Sentry (or Bugsnag / Rollbar) wired into Remix's `ErrorBoundary` + server `entry.server.tsx`. Need a project + DSN in secrets.
- [ ] **Metrics.** Prometheus `/metrics` endpoint or vendor SDK (Datadog / New Relic). Counters for hands created / settled, money-in / money-out, error rate; histograms for handler latency.
- [ ] **Tracing.** OpenTelemetry SDK with auto-instrumentation for HTTP + Prisma. Sample at ~10% in prod.
- [ ] **Secrets management.** `.env` is fine locally; in prod move to the host's secrets store (Fly secrets / Doppler / 1Password / AWS Secrets Manager). Never bake secrets into the image; document rotation procedure.
- [ ] **DB backups.** Automated point-in-time backups with ≥7-day retention. Verify restore quarterly. If the host manages Postgres (Fly/Railway/RDS), turn on PITR; otherwise schedule `pg_dump` to S3.
- [ ] **DB connection pooling.** PgBouncer (transaction mode) or Prisma Accelerate. Prisma's default opens one connection per process; under any real concurrency that gets exhausted fast.
- [ ] **Multi-instance pub/sub.** Both `broadcastBus` and `chatBus` are in-process. Going to multiple app instances requires Postgres LISTEN/NOTIFY (cheapest, already have the DB) or a real broker (Redis Streams / NATS). Subscribe/publish interface is already abstracted via `EventBus<T>`.
- [ ] **Rate limiting.** Per-IP for unauthenticated routes (`/login`, OAuth callbacks); per-user for game + chat actions. `remix-utils/rate-limit` or fronted by Cloudflare.
- [ ] **Chat moderation primitives.** Profanity filter, per-room mute/kick (creator-only), rate limit on send. Required before the chat ships to strangers.
- [ ] **Dependabot / Renovate.** Weekly PRs for npm + Docker base image updates so the audit list doesn't drift.
- [ ] **Image vulnerability scan.** Trivy (or Snyk / Docker Scout) on the built image in CI; fail PRs on high/critical CVEs.
- [ ] **Disaster recovery runbook.** `docs/RUNBOOK.md` documenting: how to roll back a deploy, how to restore from backup, how to revoke a leaked secret, how to put the site in maintenance mode.

## Deferred — major-version migrations

These were skipped during the package-update pass because each is a real migration:

- [ ] **React 18 → 19** (+ `@types/react(-dom)` 18 → 19).
- [ ] **TailwindCSS 3 → 4** (new engine, CSS-first config). _(daisyUI 4 → 5 dropped — daisyUI was removed entirely in commit c0c114f.)_
- [ ] **Prisma 5 → 7** (client API + migration command changes across two majors).
- [ ] **ESLint 8 → 9/10** (flat config migration) + **@typescript-eslint 6 → 8** (requires flat config).
- [ ] **TypeScript 5.4 → 6.**
- [ ] **Vite 5 → 8** (blocked until the Remix 2 vite plugin is verified on newer Vite, or until migrating to React Router v7).
- [ ] **Migrate to React Router v7 / Remix 3.** This is the only real fix for the remaining `npm audit` findings (all rooted in old `esbuild` pinned by `@remix-run/dev` 2.x).

## Destination state — further out

Surfaced during the multi-game / multiplayer-capable architecture review. Each becomes urgent only after the production-readiness work is in place, but worth listing so they aren't forgotten.

- [ ] **Provably-fair commit-reveal UI.** Server commits `hash(seed)` before a hand and reveals `seed` after; client can verify the shuffle. Required for any "fair play" claim, table-stakes for crypto-casino-style trust. Now applies to all five games' RNG, not just card shuffles.
- [ ] **KYC / AML / geo-fencing.** Identity verification, source-of-funds checks, jurisdiction enforcement. Mandatory the moment real money is involved.
- [ ] **Anti-collusion forensics for poker.** IP/device/account-cluster detection, hand-history pattern analysis, chip-dumping detection. Only matters once multi-human poker exists.
- [ ] **Observability — structured logging, tracing, metrics.** Per-game-type latency, money-flow dashboards, alerting on ledger discrepancies. Required to operate at any real volume.
- [ ] **Multi-region deployment + state replication.** Latency-sensitive multiplayer (poker timer ticks, roulette spin synchronization) needs regional servers; ledger needs strong consistency. Hosting choices interact with the real-time transport decision.
- [ ] **Payment-processor integration.** Deposits/withdrawals, chargeback handling, wallet/cashier flows. Distinct from the internal ledger but must reconcile against it.
