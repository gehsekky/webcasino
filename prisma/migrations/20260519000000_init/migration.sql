-- Make the uuid generator available. seed.sql also creates this on a
-- fresh prod DB, but the shadow DB Prisma uses for `migrate dev` only
-- runs migrations — so it needs to land here too.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(256) NOT NULL,
    "email" VARCHAR(256),
    "salt" VARCHAR(32),
    "password_hash" VARCHAR(512),
    "money" INTEGER NOT NULL DEFAULT 0,
    "is_ai" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_identity" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_user_id" VARCHAR(256) NOT NULL,
    "email" VARCHAR(256),
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casino_table" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "game_type" VARCHAR(32) NOT NULL,
    "minimum_bet" INTEGER NOT NULL,
    "maximum_bet" INTEGER NOT NULL,
    "max_seats" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "casino_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "table_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hand" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "table_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "data" JSON NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hand_event" (
    "hand_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "payload" JSON NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hand_event_pkey" PRIMARY KEY ("hand_id","sequence")
);

-- CreateTable
CREATE TABLE "money_transaction" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "hand_seat_id" UUID,
    "type" VARCHAR(32) NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" VARCHAR(512),
    "idempotency_key" VARCHAR(128),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hand_seat" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "hand_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "data" JSON NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hand_seat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "oauth_identity_user_id_idx" ON "oauth_identity"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_identity_provider_provider_user_id_key" ON "oauth_identity"("provider", "provider_user_id");

-- CreateIndex
CREATE INDEX "seat_user_id_idx" ON "seat"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_table_id_position_key" ON "seat"("table_id", "position");

-- CreateIndex
CREATE INDEX "hand_table_id_idx" ON "hand"("table_id");

-- CreateIndex
CREATE INDEX "hand_event_hand_id_idx" ON "hand_event"("hand_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_transaction_idempotency_key_key" ON "money_transaction"("idempotency_key");

-- CreateIndex
CREATE INDEX "hand_seat_user_id_idx" ON "hand_seat"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "hand_seat_hand_id_seat_id_key" ON "hand_seat"("hand_id", "seat_id");

-- AddForeignKey
ALTER TABLE "oauth_identity" ADD CONSTRAINT "oauth_identity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casino_table" ADD CONSTRAINT "casino_table_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "seat" ADD CONSTRAINT "seat_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "casino_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat" ADD CONSTRAINT "seat_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "hand" ADD CONSTRAINT "hand_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "casino_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hand" ADD CONSTRAINT "hand_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "hand_event" ADD CONSTRAINT "hand_event_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transaction" ADD CONSTRAINT "money_transaction_hand_seat_id_fkey" FOREIGN KEY ("hand_seat_id") REFERENCES "hand_seat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "money_transaction" ADD CONSTRAINT "money_transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "hand_seat" ADD CONSTRAINT "hand_seat_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hand_seat" ADD CONSTRAINT "hand_seat_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "hand_seat" ADD CONSTRAINT "hand_seat_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

