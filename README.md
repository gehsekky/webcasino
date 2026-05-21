# Web Casino

A multi-game multiplayer web casino. Players sign in with Google,
create a room, share a join link with friends, and play. Five games
are live: **Blackjack**, **5-Card Draw**, **Texas Hold'em**, **Slots**,
and **Roulette**. Rooms have realtime chat, can switch games between
hands, and auto-fill empty seats with AI bots.

> **Status:** active development, not production-deployed yet. No real
> money — all balances are in-app units. See [`docs/TODO.md`](docs/TODO.md)
> for the live work tracker and known limitations.

## Stack

- **Framework**: [Remix 2](https://remix.run/) on Node 22, Vite 5, React 18, TypeScript 5
- **Database**: Postgres 16 via [Prisma 5](https://www.prisma.io/) (Prisma Migrate for schema)
- **Auth**: [`remix-auth`](https://github.com/sergiodxa/remix-auth) + `remix-auth-google` (multi-provider-ready)
- **Realtime**: Server-Sent Events over an in-process `EventBus<T>` (hand events keyed by `handId`, chat keyed by `roomId`)
- **Styling**: Tailwind CSS 3
- **Tests**: Vitest + fast-check (unit), Playwright (e2e against an isolated `db_webcasino_test` database)

## Project layout

```
app/
  actions/       Server-side action wrappers (one per game + chat + room lifecycle)
  auth/          OAuth + session + CSRF + AI bot provisioning
  components/    React components (game views, chat, modals, board)
  engines/       Pure game engines (blackjack, poker/{fiveCardDraw,holdem}, slots, roulette)
  hooks/         SSE client hooks (one per game view)
  lib/           Shared libs (EventBus, gameState schemas, chat types)
  routes/        Remix routes (landing, auth, room view, room SSE channel)
e2e/             Playwright specs + fixtures + DB-bootstrap globalSetup
prisma/
  schema.prisma  Source of truth for the database schema
  migrations/    Numbered SQL migrations applied at container start
```

Game engines are pure (no DB / no IO) — they take a state + an action
and return a new state. Persistence and money movement live in
`app/actions/*Engine.server.ts` wrappers around each engine.

## Getting started

### Prerequisites

- Node 22.12 (see `.nvmrc`)
- Docker (for Postgres) — or a local Postgres 16 on port 5433
- A Google OAuth client (free, takes a couple minutes; see "Google OAuth" below)

### One-time setup

```bash
# 1. Clone + install
git clone https://github.com/gehsekky/webcasino.git
cd webcasino
npm install

# 2. Start Postgres
docker compose up -d db
#    (compose's seed.sql creates both db_webcasino and db_webcasino_test
#     on first boot, with the uuid-ossp extension)

# 3. Configure env
cp .env.example .env
#    edit .env to set SESSION_SECRET (any long random string) and
#    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET

# 4. Apply migrations
npx prisma migrate deploy
```

### Day-to-day

```bash
npm run dev         # vite dev server on http://localhost:5273
npm run typecheck   # tsc, no emit
npm run lint        # eslint
npm run format      # prettier --write
npm run format:check
npm run test        # vitest run
npm run test:watch
npm run e2e         # playwright; uses db_webcasino_test on port 5274
npm run e2e:headed  # same but with a visible browser
npm run e2e:ui      # playwright's interactive UI mode
```

### Google OAuth

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID, type "Web application"
3. Add authorized redirect URI: `http://localhost:5273/auth/google/callback`
4. Copy the Client ID and Client Secret into `.env`

The provider registry in `app/auth/providers.server.ts` is designed for
multi-provider expansion — adding a new provider is one entry in that
file plus a strategy from `remix-auth-*`.

## Testing

### Unit tests (Vitest)

Pure game-engine specs live next to the engines they exercise — every
engine has an `engine.spec.ts` covering the state machine, settlement,
and edge cases. Other specs cover the shared poker primitives
(`shared/{handEval,pot,bettingRound,bestHandFrom}.spec.ts`), the
state schemas, and the in-process event bus.

```bash
npm run test       # 222 specs across 17 files, ~600ms
```

### End-to-end tests (Playwright)

E2E uses an **isolated test database** so it can never pollute your
dev data and never runs out of bot AI fills:

- `e2e/global-setup.ts` creates `db_webcasino_test` if missing, applies
  every migration, and `TRUNCATE`s every data table.
- `playwright.config.ts`'s `webServer` block spawns a fresh dev server
  on **port 5274** with `DATABASE_URL` pointing at the test DB and
  `E2E_AUTH_BYPASS=1`.
- `vite.config.ts` reads `PORT` from env so the e2e server coexists
  with your local `npm run dev` on 5273 — you don't have to stop one
  to run the other.
- A test-only `/test-auth/login` route (refuses unless
  `E2E_AUTH_BYPASS=1` AND `NODE_ENV !== 'production'`) lets the auth
  fixture skip Google OAuth in tests.

```bash
npm run e2e        # 9 specs, ~10s
```

## Production

Not deployed yet — see `docs/TODO.md` "Production readiness" for the
checklist (healthz, structured logs, Sentry, secrets management, host
pick, etc.).

The Dockerfile is multi-stage (`base` / `prod-deps` / `builder` /
`runner`), runs as the `node` user behind `dumb-init`, and the
entrypoint runs `prisma migrate deploy` before starting the app.

```bash
npm run docker      # docker compose up --build --force-recreate --no-deps
npm run docker-clean
```

## License

MIT. See [`LICENSE`](LICENSE).
