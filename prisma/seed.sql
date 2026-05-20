-- One-shot Postgres init script: creates the database and the
-- uuid-ossp extension that the Prisma-managed schema relies on.
--
-- Schema (tables, indexes, FKs) lives in prisma/migrations/ and is
-- applied by `prisma migrate deploy` in the app's container at start.

CREATE DATABASE db_webcasino ENCODING = 'UTF8';
ALTER DATABASE db_webcasino OWNER TO postgres;

\connect db_webcasino

CREATE EXTENSION "uuid-ossp";
