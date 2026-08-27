-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_APPROVED';

-- AlterTable
ALTER TABLE "loans" ADD COLUMN "contracted_at" TIMESTAMP(3);