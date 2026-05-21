-- Soft delete for rooms. Null = active; non-null = archived (and hidden
-- from listings, join links, and the room view). Existing rooms default
-- to null (active). Historical hand / chat / transaction data stays
-- attached to the archived row.
ALTER TABLE "casino_table" ADD COLUMN "archived_at" TIMESTAMPTZ(6);

-- Composite index covers the common listing query: "active rooms I
-- created" → WHERE created_by = $1 AND archived_at IS NULL.
CREATE INDEX "casino_table_created_by_archived_at_idx"
  ON "casino_table"("created_by", "archived_at");
