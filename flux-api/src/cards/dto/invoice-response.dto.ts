import { ApiProperty } from '@nestjs/swagger';
import { CardPurchaseStatus, InvoiceStatus } from '@prisma/client';

export class InvoiceResponse {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id!: string;

  @ApiProperty({ example: '2026-08-25T00:00:00.000Z', description: 'Data de fechamento da fatura' })
  closingDate!: Date;

  @ApiProperty({ example: '2026-09-10T00:00:00.000Z', description: 'Data de vencimento da fatura' })
  dueDate!: Date;

  @ApiProperty({ enum: InvoiceStatus, example: InvoiceStatus.OPEN })
  status!: InvoiceStatus;

  @ApiProperty({ example: 4950.0 })
  totalAmount!: number;

  @ApiProperty({ example: 0.0 })
  paidAmount!: number;

  @ApiProperty({ example: null, nullable: true, description: 'Data de pagamento da fatura' })
  paidAt!: Date | null;
}

export class InvoicePurchaseResponse {
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
}

export class InvoiceDetailResponse extends InvoiceResponse {
  @ApiProperty({ type: [InvoicePurchaseResponse], description: 'Compras da fatura' })
  purchases!: InvoicePurchaseResponse[];
}