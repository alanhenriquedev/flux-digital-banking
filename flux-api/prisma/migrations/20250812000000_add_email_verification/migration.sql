-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "email_verify_token" TEXT,
ADD COLUMN     "email_verify_token_expiry" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_verify_token_key" ON "users"("email_verify_token");

-- Backfill: usuários existentes são considerados já verificados
UPDATE "users"
SET "email_verified" = true
WHERE "email_verified" = false;