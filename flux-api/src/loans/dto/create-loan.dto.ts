import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class CreateLoanDto {
  @ApiProperty({
    example: 5000,
    description: 'Valor desejado do empréstimo em reais (mín. 500, máx. 20.000)',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor deve ser um número com no máximo 2 casas decimais.' })
  @Min(500, { message: 'Valor mínimo de R$ 500,00.' })
  @Max(20000, { message: 'Valor máximo de R$ 20.000,00.' })
  amount!: number;

  @ApiProperty({
    example: 12,
    description: 'Número de parcelas (mín. 6, máx. 48)',
  })
  @Type(() => Number)
  @IsInt({ message: 'Parcelas deve ser um número inteiro.' })
  @Min(6, { message: 'Mínimo de 6 parcelas.' })
  @Max(48, { message: 'Máximo de 48 parcelas.' })
  installments!: number;
}