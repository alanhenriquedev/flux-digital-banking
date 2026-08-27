-- Lote 1 · Alertas configuráveis
-- Preferências por usuário (userId+kind únicos). Notificações existentes
-- ganham dedup_key para idempotência/anti-spam (NULL permite múltiplas).

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM (
  'NEW_DEVICE_LOGIN',
  'SUSPICIOUS_LOGIN',
  'PIX_ABOVE',
  'BALANCE_BELOW',
  'PIX_SENT',
  'PIX_RECEIVED',
  'LOAN_CONTRACTED',
  'LOAN_INSTALLMENT_DUE'
);

-- CreateTable
CREATE TABLE "alert_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold" DECIMAL(15,2),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alert_settings_user_id_kind_key" ON "alert_settings"("user_id", "kind");
CREATE INDEX "alert_settings_user_id_idx" ON "alert_settings"("user_id");

-- AddForeignKey
ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tipos de notificação de alerta (aditivo)
ALTER TYPE "NotificationType" ADD VALUE 'ALERT_SECURITY';
ALTER TYPE "NotificationType" ADD VALUE 'ALERT_MOVEMENT';
ALTER TYPE "NotificationType" ADD VALUE 'ALERT_ACCOUNT';

-- Anti-duplicidade de notificações
ALTER TABLE "notifications" ADD COLUMN "dedup_key" TEXT;
CREATE INDEX "notifications_user_id_dedup_key_idx" ON "notifications"("user_id", "dedup_key");
