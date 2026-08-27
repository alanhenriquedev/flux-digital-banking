-- AlterTable: número (PAN) sintético de demonstração para o cartão

-- 1) Adiciona a coluna como NULLABLE primeiro (existem cartões na tabela)
ALTER TABLE "cards" ADD COLUMN "pan_number" TEXT;

-- 2) Backfill: gera um PAN sintético de 16 dígitos para cartões já existentes
--    Formato: BIN de demonstração '4532' + 11 dígitos + last4 já armazenado.
--    Não é um cartão real, não é utilizável em pagamentos, apenas portfólio.
DO $$
DECLARE
  r  RECORD;
  c  BIGINT;
  pan TEXT;
BEGIN
  FOR r IN SELECT id, last4 FROM "cards" WHERE "pan_number" IS NULL LOOP
    c := floor(random() * 100000000000);
    pan := '4532' || lpad(c::text, 11, '0') || r.last4;
    UPDATE "cards" SET "pan_number" = pan WHERE id = r.id;
  END LOOP;
END $$;

-- 3) Coluna obrigatória + unicidade
ALTER TABLE "cards" ALTER COLUMN "pan_number" SET NOT NULL;
CREATE UNIQUE INDEX "cards_pan_number_key" ON "cards"("pan_number");