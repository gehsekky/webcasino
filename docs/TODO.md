# TODO

Actionable items from the architecture and best-practices review.
Roughly ordered by ROI within each section.

> **Current focus (2026-05-19):** Finish the game-engine architecture, then
> rewrite the frontend from scratch. **All UI polish and component-level
> changes are deferred** — touch components only when a backend change
> mechanically requires it. The "Architecture" items below marked
> *(UI — deferred)* live behind that gate.

## Critical correctness bugs

- [x] **Deck is missing 10s.** `app/lib/Card/index.ts:6` — add `'10'` to the `ranks` array. Every blackjack game is currently played with a 48-card deck. *(Done — task #2; covered by `Deck.spec.ts`.)*
- [x] **`forEach` with `async` callback skips awaits.** `app/actions/game.ts:164` — replace with `for (const game_player of game.game_player) { await dealToPlayer(...) }`. Without this, `dealToDealer` and the rest of `startGame` run before player deals finish. *(Done — task #2.)*
- [x] **Query escapes the transaction.** `app/actions/game.ts:171` — `getGameById(game?.id || '')` runs inside `prisma.$transaction` without passing `tx`. Pass `tx` so the re-read sees in-flight writes. *(Done — task #2.)*
- [x] **Misleading comment on debit path.** `app/actions/game.ts:182-185` — comment claims money is already debited at bet time, but it isn't (no debit in `placeInitialBet`). Either remove the comment or rewrite it to match reality. *(Done — task #2.)*

## Security

- [x] **No authentication.** Was: `findOrCreateUserByName` created users by name only with no password check. **Now:** Google OAuth via `remix-auth` + `remix-auth-google`, with `oauth_identity` table, session storage, and an extensible provider registry in `app/auth/providers.server.ts`. *(Done — task #3.)*
- [x] **URL-based authorization.** `/game/$gamePlayerId` lets anyone with the UUID control that seat. **Now:** `requireSeat(request, gamePlayerId)` in `app/auth/guards.server.ts` enforces `game_player.user_id === sessionUser.id`. *(Done — task #3.)*
- [x] **No bet validation.** `placeInitialBet` now validates `amount > 0` (positive integer), `amount <= gamePlayer.user.money`, and `minimumBet <= amount <= maximumBet`. Hard safety net: the atomic `UPDATE user SET money = money + delta WHERE money >= minRequired` in `recordMoneyTransaction` rejects any insufficient-funds debit. *(Done — task #4.)*
- [ ] **No CSRF protection** on `<Form method="post">` flows. Consider `remix-utils/csrf` or equivalent if this leaves localhost.

## Type safety & data model

- [x] **Replace `as unknown as` casts with runtime validation.** `app/lib/gameState.ts` defines `BlackjackStateSchema`, `GamePlayerStateSchema`, and a `GameStateSchema` discriminated union; `parseBlackjackState()` / `parseGamePlayerState()` validate at every read site across `actions/`, `routes/`, and `components/`. `Card.suit` and `Card.rank` narrowed to enum types so structural compatibility holds. Schema specs added in `gameState.spec.ts`. Remaining `as unknown as` sites are limited to Prisma's `JsonObject` write typing and the remix-auth Strategy interface cast. *(Done — task #5.)*
- [x] **Lift stringly-typed enums to TS string literal unions.** The blackjack engine (`app/engines/blackjack/`) now uses discriminated-union `BlackjackAction` (`'place_bet' | 'hit' | 'stay' | 'double_down' | 'surrender' | 'dealer_play' | 'deal_initial'`) and a tight `PlayerStatus` union. Money transaction type narrowed to `'debit' | 'credit'` in `recordMoneyTransaction`. The legacy `'indexOf(x) > -1'` checks in `actions/game.server.ts` / `gamePlayer.server.ts` will go away when those files are rewritten to delegate to the engine (planned with #9 / #10). *(Done — task #6.)*
- [ ] **Reconcile schema source-of-truth.** `prisma/schema.prisma` and `prisma/seed.sql` both define tables and will drift. Pick one: run `prisma migrate dev` (and reduce `seed.sql` to inserts only), or stay SQL-first and stop using Prisma for schema sync.
- [x] **Make `updated_at` automatic.** All six `updated_at` columns in `schema.prisma` now carry `@updatedAt`; the client maintains the timestamp on every UPDATE. The legacy `gamePlayer.ts:78` file no longer exists (engine refactor); the remaining manual `updated_at: new Date()` calls in `handEngine.server.ts` / `pokerEngine.server.ts` were dropped as redundant.
- [ ] **Move deck out of the JSON blob (longer-term).** Every hit/stay rewrites the entire deck array in `game.data`. Consider deriving deck state from a seed + dealt-cards log, or a per-card table.
- [ ] **Consider money in cents (longer-term).** `Math.floor(bet * 1.5)` already truncates on blackjack payouts; cents or `Decimal` would avoid this.

## Architecture

- [x] **Singleton Prisma client.** All `app/actions/*` files now import `prisma` from `db.server`. `PrismaTransactionClient` type lives in `db.server.ts` (re-exported from `actions/game.server.ts` for compatibility). *(Done — task #4.)*
- [x] **Use `.server.ts` suffix for server-only modules.** All `app/actions/*.ts` renamed to `*.server.ts` via `git mv` so Vite reliably tree-shakes them out of the client bundle. Imports updated across `routes/`, `components/`, and internally within `actions/`. *(Done — task #4.)*
- [ ] **Fix the import source in `routes/game.$gamePlayerId.tsx:2`.** `json` and `useLoaderData` should come from `@remix-run/react`, not `react-router`. Works today but isn't the documented surface. *(UI — deferred; will be handled by the frontend rewrite.)*
- [ ] **Add `ErrorBoundary` exports** to routes (`_index.tsx`, `game.$gamePlayerId.tsx`) so loader/action errors render gracefully instead of crashing. *(UI — deferred.)*
- [x] **Reduce coupling between `game.ts` and `gamePlayer.ts`.** After engine integration (task #11), both files are reduced to read-only DTO type aliases + a single `findUnique` each. No cross-imports. All state transitions live in `actions/handEngine.server.ts`. *(Done — task #11.)*
- [ ] **Replace `window.open` resume flow** in `app/components/CasinoLanding/index.tsx:13` with normal in-tab navigation. *(UI — deferred.)*

## Tooling & DX

- [x] **Add tests.** Vitest + fast-check installed. Spec files for `app/lib/Card/index.ts` (`Card.spec.ts`) and `app/lib/Deck/index.ts` (`Deck.spec.ts`); 21 tests covering numeric/face/ace edge cases, deck completeness, and shuffle preservation. Test file convention: `*.spec.ts`. *(Done — task #1.)*
- [x] **Add CI.** `.github/workflows/ci.yml` runs `npm ci`, `typecheck`, `lint`, and `test` on push to main and on PRs, using Node from `.nvmrc` (22.1.0). `concurrency.cancel-in-progress` so stacked pushes don't waste minutes.
- [ ] **Add Prettier.** Inconsistencies like `(param : Type)` (space before colon) would resolve automatically; pairs well with `eslint-config-prettier`.
- [ ] **Multi-stage Dockerfile.** Current image ships devDependencies; build in one stage, copy `build/` + `node_modules` (with `--omit=dev`) into a slimmer runtime stage.
- [ ] **Move `prisma generate` out of `entrypoint.sh`** into the Dockerfile build step. Generating at container start delays cold boot and ties prod startup to Prisma's binary download path.
- [x] **Expand `.dockerignore`.** Now excludes `.git`, `.cache`, `build`, `.env(*)` (with an `.env.example` allowlist), `*.md`, `.github`, IDE dirs, and `coverage` in addition to `node_modules`.
- [x] **Remove `postcss.config.cjs` from `tsconfig.json` `include`** — dropped; the toolchain reads it directly as CommonJS, the include entry was a no-op.
- [ ] **Decide on Node version.** `.nvmrc` says `v22.1.0`, `Dockerfile` uses `node:22.1-alpine`, `package.json` engines says `>=18.0.0`. Align them (probably pin engines to `>=22`).

## Deferred — major-version migrations

These were skipped during the package-update pass because each is a real migration:

- [ ] **React 18 → 19** (+ `@types/react(-dom)` 18 → 19).
- [ ] **TailwindCSS 3 → 4** (new engine, CSS-first config) + **daisyUI 4 → 5** (requires Tailwind 4).
- [ ] **Prisma 5 → 7** (client API + migration command changes across two majors).
- [ ] **ESLint 8 → 9/10** (flat config migration) + **@typescript-eslint 6 → 8** (requires flat config).
- [ ] **TypeScript 5.4 → 6.**
- [ ] **Vite 5 → 8** (blocked until the Remix 2 vite plugin is verified on newer Vite, or until migrating to React Router v7).
- [ ] **Migrate to React Router v7 / Remix 3.** This is the only real fix for the remaining 15 `npm audit` findings (all rooted in old `esbuild` pinned by `@remix-run/dev` 2.17).

## Destination state — further out

Surfaced during the multi-game / multiplayer-capable architecture review. Each becomes urgent only after the top-10 architectural work is in place, but worth listing so they aren't forgotten.

- [ ] **Provably-fair commit-reveal UI.** Server commits `hash(seed)` before a hand and reveals `seed` after; client can verify the shuffle. Required for any "fair play" claim, table-stakes for crypto-casino-style trust.
- [ ] **KYC / AML / geo-fencing.** Identity verification, source-of-funds checks, jurisdiction enforcement. Mandatory the moment real money is involved.
- [ ] **Anti-collusion forensics for poker.** IP/device/account-cluster detection, hand-history pattern analysis, chip-dumping detection. Only matters once multi-human poker exists.
- [ ] **Observability — structured logging, tracing, metrics.** Per-game-type latency, money-flow dashboards, alerting on ledger discrepancies. Required to operate at any real volume.
- [ ] **Multi-region deployment + state replication.** Latency-sensitive multiplayer (poker timer ticks) needs regional servers; ledger needs strong consistency. Hosting choices interact with the real-time transport decision (item #7 in the top-10).
- [ ] **Payment-processor integration.** Deposits/withdrawals, chargeback handling, wallet/cashier flows. Distinct from the internal ledger but must reconcile against it.
