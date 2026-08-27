import { ApiProperty } from '@nestjs/swagger';
import { CardBrand, CardStatus, CardType } from '@prisma/client';

export class CardResponse {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', description: 'ID do cartão' })
  id!: string;

  @ApiProperty({ enum: CardType, example: CardType.VIRTUAL })
  type!: CardType;

  @ApiProperty({ enum: CardBrand, example: CardBrand.FLUX })
  brand!: CardBrand;

  @ApiProperty({ example: '2871', description: 'Últimos 4 dígitos do cartão (para exibição)' })
  last4!: string;

  @ApiProperty({
    example: '4532 1234 5678 2871',
    description:
      'Número completo do cartão (PAN sintético de demonstração). Retornado apenas para o usuário autenticado dono do cartão; não é utilizável em pagamentos reais.',
  })
  fullNumber!: string;

  @ApiProperty({ enum: CardStatus, example: CardStatus.ACTIVE })
  status!: CardStatus;

  @ApiProperty({ example: 5000.0, description: 'Limite total do cartão' })
  creditLimit!: number;

  @ApiProperty({ example: 5000.0, description: 'Limite disponível para compras' })
  availableLimit!: number;

  @ApiProperty({
    example: '2031-08-13T00:00:00.000Z',
    description: 'Data de expiração do cartão (apenas para exibição)',
  })
  expiresAt!: Date | null;

  @ApiProperty({ example: '2026-08-13T00:00:00.000Z' })
  createdAt!: Date;
}