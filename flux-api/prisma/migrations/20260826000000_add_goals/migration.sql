-- Lote 1 · Metas financeiras
-- A reserva da meta é uma movimentação real: depositar debita o saldo da
-- conta (transação GOAL_DEPOSIT/OUT) e credita goal.current_amount;
-- retirar faz o caminho inverso (GOAL_WITHDRAW/IN). Integridade contábil
-- fica no próprio ledger de transactions.

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');
CREATE TYPE "GoalContributionType" AS ENUM ('DEPOSIT', 'WITHDRAW');

-- Novos tipos de transação das metas (aditivo)
ALTER TYPE "TransactionType" ADD VALUE 'GOAL_DEPOSIT';
ALTER TYPE "TransactionType" ADD VALUE 'GOAL_WITHDRAW';

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target_amount" DECIMAL(15,2) NOT NULL,
    "current_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_contributions" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "type" "GoalContributionType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_user_id_status_idx" ON "goals"("user_id", "status");

-- CreateIndex
CREATE INDEX "goal_contributions_goal_id_created_at_idx" ON "goal_contributions"("goal_id", "created_at");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
