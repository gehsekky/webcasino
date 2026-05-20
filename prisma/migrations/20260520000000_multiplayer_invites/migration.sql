-- Shareable join links: opaque short token per room.
ALTER TABLE "casino_table" ADD COLUMN "join_token" VARCHAR(64);
CREATE UNIQUE INDEX "casino_table_join_token_key" ON "casino_table"("join_token");

-- AI fills aren't tied to a persistent seat row. Postgres UNIQUE allows
-- multiple NULLs, so the existing (hand_id, seat_id) unique still keeps
-- humans from double-occupying a hand while letting bots fill freely.
ALTER TABLE "hand_seat" ALTER COLUMN "seat_id" DROP NOT NULL;

-- Pending / accepted / declined room invitations.
CREATE TABLE "table_invitation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "table_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "table_invitation_table_id_user_id_key"
  ON "table_invitation"("table_id", "user_id");

CREATE INDEX "table_invitation_user_id_idx" ON "table_invitation"("user_id");

ALTER TABLE "table_invitation"
  ADD CONSTRAINT "table_invitation_table_id_fkey"
  FOREIGN KEY ("table_id") REFERENCES "casino_table"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "table_invitation"
  ADD CONSTRAINT "table_invitation_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
