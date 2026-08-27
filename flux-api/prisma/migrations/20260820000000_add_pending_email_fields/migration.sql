-- Adiciona campos de troca de e-mail pendente (pending email)
-- pendingEmail: novo e-mail aguardando confirmação
-- pendingEmailToken: SHA-256 do token de confirmação (o token cru nunca é persistido)
-- pendingEmailTokenExpiry: validade do link de confirmação

-- AlterTable
ALTER TABLE "users" ADD COLUMN "pending_email" TEXT;
ALTER TABLE "users" ADD COLUMN "pending_email_token" TEXT;
ALTER TABLE "users" ADD COLUMN "pending_email_token_expiry" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_pending_email_token_key" ON "users"("pending_email_token");
