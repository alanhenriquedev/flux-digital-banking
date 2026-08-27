-- Corrige o comprimento do PAN sintético para 16 dígitos
-- (BIN demo '4532' + 8 dígitos intermediários + last4). Determinístico por cartão.

UPDATE "cards"
SET "pan_number" = '4532' || lpad((abs(hashtextextended(id, 42)) % 100000000)::text, 8, '0') || last4
WHERE "pan_number" IS NOT NULL;