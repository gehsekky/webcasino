-- Sit-out flag on persistent room seats. Default false so existing
-- rows stay in rotation; flipped to true automatically when the
-- seat owner times out, cleared when they click "Rejoin next hand."
ALTER TABLE "seat" ADD COLUMN "sitting_out" BOOLEAN NOT NULL DEFAULT false;
