ALTER TABLE "transactions" ADD COLUMN "idempotency_key" TEXT;
ALTER TABLE "transactions" ADD COLUMN "idempotency_hash" TEXT;
ALTER TABLE "transactions" ADD COLUMN "goal_id" TEXT;
CREATE UNIQUE INDEX "transactions_account_id_idempotency_key_key"
  ON "transactions"("account_id", "idempotency_key");
