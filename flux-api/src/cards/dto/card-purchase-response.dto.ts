import { ApiProperty } from '@nestjs/swagger';
import { CardPurchaseStatus, InvoiceStatus } from '@prisma/client';

export class InvoiceSummary {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id!: string;

  @ApiProperty({ example: '2026-08-25T00:00:00.000Z', description: 'Data de fechamento da fatura' })
  closingDate!: Date;

  @ApiProperty({ example: '2026-09-10T00:00:00.000Z', description: 'Data de vencimento da fatura' })
  dueDate!: Date;

  @ApiProperty({ example: 250.0 })
  totalAmount!: number;

  @ApiProperty({ example: 0.0 })
  paidAmount!: number;

  @ApiProperty({ enum: InvoiceStatus, example: InvoiceStatus.OPEN })
  status!: InvoiceStatus;
}

export class CardPurchaseResponse {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id!: string;

  @ApiProperty({ example: 250.0 })
  amount!: number;

  @ApiProperty({ example: 'Mercado XYZ' })
  description!: string;

  @ApiProperty({ enum: CardPurchaseStatus, example: CardPurchaseStatus.COMPLETED })
  status!: CardPurchaseStatus;

  @ApiProperty({ example: '2026-08-13T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ type: InvoiceSummary })
  invoice!: InvoiceSummary;

  @ApiProperty({ example: 4750.0, description: 'Limite disponível após a compra' })
  availableLimit!: number;
}