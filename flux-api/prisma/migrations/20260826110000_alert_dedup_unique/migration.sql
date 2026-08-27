-- Correção Lote 1 · Alertas: o anti-duplicidade exige índice ÚNICO.
-- Valores NULL (notificações sem dedup_key) continuam permitidos em
-- quantidade livre, conforme comportamento do PostgreSQL.

DROP INDEX IF EXISTS "notifications_user_id_dedup_key_idx";

CREATE UNIQUE INDEX "notifications_user_id_dedup_key_idx" ON "notifications"("user_id", "dedup_key");
