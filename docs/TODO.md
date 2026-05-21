# TODO

Actionable items from the architecture and best-practices review.
Roughly ordered by ROI within each section.

> **Current focus (2026-05-20):** Five games live (blackjack, 5-card
> draw, Texas Hold'em, slots, roulette) on the multiplayer room model
> with chat, room naming, room archival, and mid-room game switching.
> UI is being iterated actively — the earlier "defer all UI" gate is
> lifted. Next-up candidates: production-readiness items (`/healthz`,
> structured logs, Sentry), smarter Hold'em AI, "show archived rooms"
> filter, and the deferred major-version migrations.

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
- [ ] **Tone-aware focus rings.** `buttonClass`'s focus ring is hardcoded yellow-400. On the yellow win banner the ring is mostly invisible (the 2px emerald-950 offset is the only visible cue). Thread the tone through `buttonClass` so winning-state buttons get a slate focus ring instead.
- [ ] **Comprehensive a11y audit.** Spot-checks so far have been ad-hoc. Run an axe-core or Lighthouse a11y pass on the landing page, room view (each game), the chat pane, and the create-game modal. Areas to examine: keyboard tab order, focus traps in the modal, screen-reader announcements for SSE-driven updates (chat messages, hand transitions), color-only signaling on the roulette betting board (red/black bets distinguished by background color — text labels are present but the small swatches in `BetChip` may be hard to read with low color vision).

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

- [ ] **Healthcheck endpoint.** `/healthz` returns 200 + DB ping. Required by every orchestrator (k8s probes, Fly checks, ALB targets).
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
