import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class NotificationResponse {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id!: string;

  @ApiProperty({ enum: NotificationType, example: NotificationType.PIX_IN })
  type!: NotificationType;

  @ApiProperty({ example: 'PIX de R$ 150,00 recebido de Maria' })
  title!: string;

  @ApiProperty({ example: 'Recebido de Maria · Conta 12345678', nullable: true })
  message!: string | null;

  @ApiProperty({ example: 150.0, nullable: true, description: 'Valor monetário do evento (se houver)' })
  amount!: number | null;

  @ApiProperty({ example: 'transaction', nullable: true, description: 'Tipo da entidade relacionada (deep-link)' })
  entityType!: string | null;

  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', nullable: true, description: 'ID da entidade relacionada' })
  entityId!: string | null;

  @ApiProperty({ example: null, nullable: true, description: 'Data de leitura; null = não lida' })
  readAt!: Date | null;

  @ApiProperty({ example: '2026-08-14T19:00:00.000Z' })
  createdAt!: Date;
}