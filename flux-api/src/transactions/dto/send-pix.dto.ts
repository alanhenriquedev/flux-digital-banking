import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  IsUUID,
} from 'class-validator';

export class SendPixDto {
  @ApiPropertyOptional({ description: 'Token de confirmação de risco emitido pelo backend' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  riskConfirmation?: string;

  @ApiPropertyOptional({ description: 'Chave de idempotência do envio' })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;

  @ApiProperty({
    example: '12345678',
    description: 'Número da conta de destino',
  })
  @IsString()
  @Matches(/^\d{8}$/, {
    message: 'Número da conta deve conter 8 dígitos.',
  })
  accountNumber!: string;

  @ApiProperty({ example: 100.0, description: 'Valor do PIX em reais' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor deve ser um número com no máximo 2 casas decimais.' })
  @Min(0.01, { message: 'Valor deve ser maior que zero.' })
  @Max(100000, { message: 'Valor acima do limite permitido para um PIX.' })
  amount!: number;

  @ApiPropertyOptional({ example: 'Almoço', description: 'Descrição opcional' })
  @IsOptional()
  @IsString()
  @MaxLength(140, { message: 'Descrição deve ter no máximo 140 caracteres.' })
  description?: string;
}
