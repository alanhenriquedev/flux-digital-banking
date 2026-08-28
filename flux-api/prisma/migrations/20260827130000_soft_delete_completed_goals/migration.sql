ALTER TABLE "goals" ADD COLUMN "deleted_at" TIMESTAMP(3);
CREATE INDEX "goals_user_id_deleted_at_idx" ON "goals"("user_id", "deleted_at");
