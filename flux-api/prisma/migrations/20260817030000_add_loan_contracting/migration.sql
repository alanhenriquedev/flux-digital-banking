-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'LOAN';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_DISBURSED';

-- CreateEnum
CREATE TYPE "LoanInstallmentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

-- CreateTable
CREATE TABLE "loan_installments" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "principal" DECIMAL(15,2) NOT NULL,
    "interest" DECIMAL(15,2) NOT NULL,
    "status" "LoanInstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(15,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loan_installments_loan_id_number_key" ON "loan_installments"("loan_id", "number");

-- CreateIndex
CREATE INDEX "loan_installments_loan_id_due_date_status_idx" ON "loan_installments"("loan_id", "due_date", "status");

-- AddForeignKey
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;