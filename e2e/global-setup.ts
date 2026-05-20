import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Test-database bootstrapper. Runs once per Playwright invocation before
 * any specs are touched. Idempotent: safe to run repeatedly.
 *
 * Steps:
 *   1. Connect to the Postgres admin DB. If `db_webcasino_test` doesn't
 *      exist, create it and add the `uuid-ossp` extension that the
 *      Prisma-managed schema relies on.
 *   2. Run `prisma migrate deploy` against the test DB to apply every
 *      committed migration. Migrate-deploy is idempotent.
 *   3. Truncate all data tables. AI users will re-provision lazily on
 *      first use. After this step the DB is structurally complete but
 *      empty — every spec starts from the same clean slate.
 *
 * Tweak `ADMIN_URL` if your Postgres isn't on 5433; the rest derives
 * from it.
 */

const HOST = process.env.E2E_PG_HOST ?? 'localhost';
const PORT = process.env.E2E_PG_PORT ?? '5433';
const USER = process.env.E2E_PG_USER ?? 'postgres';
const PASSWORD = process.env.E2E_PG_PASSWORD ?? 'postgres';
const TEST_DB = process.env.E2E_PG_DB ?? 'db_webcasino_test';

const ADMIN_URL = `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/postgres`;
const TEST_URL = `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${TEST_DB}?schema=public`;

/**
 * All data tables in dependency-safe order. `TRUNCATE ... CASCADE`
 * handles FK ordering for us, but listing them explicitly avoids
 * accidentally truncating something unrelated and documents intent.
 * Quoted `"user"` because it's a reserved word in SQL.
 */
const TRUNCATE_TABLES = [
  'chat_message',
  'money_transaction',
  'hand_event',
  'hand_seat',
  'hand',
  'table_invitation',
  'seat',
  'casino_table',
  'oauth_identity',
  '"user"',
];

export default async function globalSetup(): Promise<void> {
  await ensureTestDatabase();
  applyMigrations();
  await truncateAll();
}

async function ensureTestDatabase(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    // CREATE DATABASE can't run inside a transaction; `pg`'s Client
    // sends single statements without wrapping, so this works directly.
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    // eslint-disable-next-line no-console
    console.log(`[e2e setup] created database ${TEST_DB}`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== '42P04') throw err; // 42P04 = duplicate_database (already exists)
  } finally {
    await admin.end();
  }

  const test = new Client({ connectionString: TEST_URL });
  await test.connect();
  try {
    await test.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  } finally {
    await test.end();
  }
}

function applyMigrations(): void {
  // `prisma migrate deploy` is the deploy-time variant — applies pending
  // migrations and exits. No prompts. The CWD is the project root when
  // Playwright runs globalSetup, so the schema file is found relative to
  // `npx prisma` automatically.
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_URL },
  });
}

async function truncateAll(): Promise<void> {
  const test = new Client({ connectionString: TEST_URL });
  await test.connect();
  try {
    await test.query(`TRUNCATE TABLE ${TRUNCATE_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await test.end();
  }
}
