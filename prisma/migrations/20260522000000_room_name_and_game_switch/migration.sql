-- Add a display name to rooms. Unique per creator only — two different
-- users can each have a "Friday Night" room. Backend uses `id` everywhere;
-- `name` is purely for UI.
--
-- For existing rows: backfill with `Room <first 8 chars of id>` so the
-- NOT NULL + UNIQUE(created_by, name) constraints can land safely. The
-- truncated id is unique enough across a single creator's small set of
-- rooms (and we keep `id` as the real key anyway).
ALTER TABLE "casino_table" ADD COLUMN "name" VARCHAR(128);

UPDATE "casino_table"
   SET "name" = 'Room ' || SUBSTRING("id"::text, 1, 8)
 WHERE "name" IS NULL;

ALTER TABLE "casino_table" ALTER COLUMN "name" SET NOT NULL;

CREATE UNIQUE INDEX "casino_table_created_by_name_key"
  ON "casino_table"("created_by", "name");
