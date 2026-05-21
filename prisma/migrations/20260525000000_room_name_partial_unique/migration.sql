-- Replace the full `(created_by, name)` unique with a partial unique
-- that only applies when the room isn't archived. Lets a creator
-- recycle a name after archiving the prior room of that name.
--
-- Partial indexes aren't expressible in Prisma's @@unique, so this
-- index lives in raw SQL. schema.prisma documents the arrangement.
DROP INDEX "casino_table_created_by_name_key";

CREATE UNIQUE INDEX "casino_table_created_by_name_active_key"
  ON "casino_table" ("created_by", "name")
  WHERE "archived_at" IS NULL;
