import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  Max,
  Min,
} from 'class-validator';

const MAX_GOAL_MOVE = 1000000;

export class GoalAmountDto {
  @ApiProperty({ example: 250, description: 'Valor em reais (máximo 2 casas decimais)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor deve ser um número com no máximo 2 casas decimais.' })
  @Min(0.01, { message: 'Valor deve ser maior que zero.' })
  @Max(MAX_GOAL_MOVE, { message: 'Valor acima do limite permitido.' })
  amount!: number;
}
