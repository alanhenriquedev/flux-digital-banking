import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export const ALERT_KINDS = [
  'NEW_DEVICE_LOGIN',
  'SUSPICIOUS_LOGIN',
  'PIX_ABOVE',
  'BALANCE_BELOW',
  'PIX_SENT',
  'PIX_RECEIVED',
  'LOAN_CONTRACTED',
  'LOAN_INSTALLMENT_DUE',
] as const;

export type AlertKindValue = (typeof ALERT_KINDS)[number];

export class UpdateAlertSettingDto {
  @ApiProperty({ example: true, description: 'Ativa/desativa o alerta' })
  @IsOptional()
  @IsBoolean({ message: 'enabled deve ser booleano.' })
  enabled?: boolean;

  @ApiPropertyOptional({
    example: 500,
    description:
      'Limiar em reais para alertas com threshold (PIX_ABOVE, BALANCE_BELOW). null remove o limiar personalizado.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Limiar deve ter no máximo 2 casas decimais.' })
  @Min(0, { message: 'Limiar não pode ser negativo.' })
  threshold?: number | null;
}

export class UpdateAlertSettingRouteDto extends UpdateAlertSettingDto {
  @ApiProperty({ enum: ALERT_KINDS })
  @IsIn(ALERT_KINDS as unknown as string[], { message: 'Tipo de alerta desconhecido.' })
  kind!: AlertKindValue;
}
