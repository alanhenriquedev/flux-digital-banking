ALTER TYPE "TransactionType" ADD VALUE 'ACCOUNT_OPENING';

CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "amount" DECIMAL(15,2),
    "entity_type" TEXT,
    "entity_id" TEXT,
    "dedup_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_outbox_user_id_dedup_key_key"
  ON "notification_outbox"("user_id", "dedup_key");
CREATE INDEX "notification_outbox_available_at_idx"
  ON "notification_outbox"("available_at");
ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
