-- One-shot Postgres init script: creates the databases and the
-- uuid-ossp extension that the Prisma-managed schema relies on.
--
-- Schema (tables, indexes, FKs) lives in prisma/migrations/ and is
-- applied by `prisma migrate deploy` in the app's container at start
-- (and by `e2e/global-setup.ts` for the test database).

CREATE DATABASE db_webcasino ENCODING = 'UTF8';
ALTER DATABASE db_webcasino OWNER TO postgres;

\connect db_webcasino

CREATE EXTENSION "uuid-ossp";

\connect postgres

CREATE DATABASE db_webcasino_test ENCODING = 'UTF8';
ALTER DATABASE db_webcasino_test OWNER TO postgres;

\connect db_webcasino_test

CREATE EXTENSION "uuid-ossp";
