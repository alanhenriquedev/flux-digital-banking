import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCardPurchaseDto {
  @ApiPropertyOptional({
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    description: 'ID do cartão (opcional — usa o cartão do usuário por padrão)',
  })
  @IsOptional()
  @IsString()
  cardId?: string;

  @ApiProperty({ example: 250.0, description: 'Valor da compra em reais (até 2 casas decimais)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor deve ser um número com no máximo 2 casas decimais.' })
  @Min(0.01, { message: 'Valor deve ser maior que zero.' })
  amount!: number;

  @ApiPropertyOptional({ example: 'Mercado XYZ', description: 'Descrição do estabelecimento' })
  @IsOptional()
  @IsString()
  @MaxLength(140, { message: 'Descrição deve ter no máximo 140 caracteres.' })
  description?: string;
}