import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateGoalDto {
  @ApiProperty({ example: 'Viagem', description: 'Nome da meta' })
  @IsString()
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'Nome deve ter no máximo 80 caracteres.' })
  name!: string;

  @ApiPropertyOptional({ example: 'Férias em dezembro' })
  @IsOptional()
  @IsString()
  @MaxLength(240, { message: 'Descrição deve ter no máximo 240 caracteres.' })
  description?: string;

  @ApiProperty({ example: 5000, description: 'Valor objetivo em reais' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor objetivo deve ter no máximo 2 casas decimais.' })
  @Min(1, { message: 'Valor objetivo deve ser pelo menos R$ 1,00.' })
  @Max(100000000, { message: 'Valor objetivo acima do limite permitido.' })
  targetAmount!: number;

  @ApiPropertyOptional({ description: 'Data alvo opcional (ISO 8601)' })
  @IsOptional()
  @IsDateString({}, { message: 'Data alvo inválida.' })
  deadline?: string;
}
