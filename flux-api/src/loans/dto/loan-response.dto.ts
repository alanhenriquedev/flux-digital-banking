import { ApiProperty } from '@nestjs/swagger';
import { LoanStatus } from '@prisma/client';

export class LoanResponse {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id!: string;

  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  userId!: string;

  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  accountId!: string;

  @ApiProperty({ enum: LoanStatus, example: LoanStatus.APPROVED })
  status!: LoanStatus;

  @ApiProperty({ example: 5000 })
  amount!: number;

  @ApiProperty({ example: 0.0199 })
  interestRate!: number;

  @ApiProperty({ example: 12 })
  installments!: number;

  @ApiProperty({ example: 472.51 })
  installmentValue!: number;

  @ApiProperty({ example: 5670.12 })
  totalAmount!: number;

  @ApiProperty({ example: 670.12 })
  interestTotal!: number;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z' })
  requestedAt!: string;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', nullable: true })
  approvedAt!: string | null;

  @ApiProperty({ example: null, nullable: true })
  rejectedAt!: string | null;

  @ApiProperty({ example: null, nullable: true })
  contractedAt!: string | null;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z' })
  updatedAt!: string;
}