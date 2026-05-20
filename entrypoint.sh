#!/bin/sh
set -e

# Apply any pending Prisma migrations against the production DB
# before the server starts. Aborts startup on migration failure so
# the orchestrator can roll back instead of serving against a stale
# schema. Idempotent: a no-op when the DB is already up to date.
cd /app
npx prisma migrate deploy

exec npm run start
