-- Agrupamento de sessões por dispositivo (V1)
-- device_id_hash = HMAC-SHA256 do deviceId persistido no navegador do cliente.
-- O UUID cru NUNCA é persistido — somente o hash.
-- Nullable para manter compatibilidade: sessões antigas (ou logins sem
-- deviceId) continuam válidas e são exibidas individualmente.

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN "device_id_hash" TEXT;

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_device_id_hash_idx" ON "auth_sessions"("user_id", "device_id_hash");
