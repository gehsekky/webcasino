-- Per-room chat. Realtime delivery flows through the in-process chatBus;
-- this table is the durable backing store so members see scrollback on
-- reload. Retention/pruning policy can land later.
CREATE TABLE "chat_message" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "table_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_message_table_id_created_at_idx"
  ON "chat_message"("table_id", "created_at");

ALTER TABLE "chat_message"
  ADD CONSTRAINT "chat_message_table_id_fkey"
  FOREIGN KEY ("table_id") REFERENCES "casino_table"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_message"
  ADD CONSTRAINT "chat_message_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
