import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateGoalDto {
  @ApiPropertyOptional({ example: 'Viagem para o litoral' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'Nome deve ter no máximo 80 caracteres.' })
  name?: string;

  @ApiPropertyOptional({ example: 'Férias em dezembro' })
  @IsOptional()
  @IsString()
  @MaxLength(240, { message: 'Descrição deve ter no máximo 240 caracteres.' })
  description?: string;

  @ApiPropertyOptional({ example: 6000, description: 'Novo valor objetivo em reais' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor objetivo deve ter no máximo 2 casas decimais.' })
  @Min(1, { message: 'Valor objetivo deve ser pelo menos R$ 1,00.' })
  @Max(100000000, { message: 'Valor objetivo acima do limite permitido.' })
  targetAmount?: number;

  @ApiPropertyOptional({ description: 'Nova data alvo opcional (ISO 8601)' })
  @IsOptional()
  @IsDateString({}, { message: 'Data alvo inválida.' })
  deadline?: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED'], description: 'Pausar ou retomar a meta' })
  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED'], { message: 'Status inválido. Use ACTIVE ou PAUSED.' })
  status?: 'ACTIVE' | 'PAUSED';
}
