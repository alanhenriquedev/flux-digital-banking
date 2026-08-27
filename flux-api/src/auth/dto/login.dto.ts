import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'alan@email.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Flux2026x' })
  @IsString()
  @IsNotEmpty()
  password!: string;

  /**
   * Identificador persistente do navegador (crypto.randomUUID salvo em
   * localStorage). Usado APENAS para agrupar sessões por dispositivo.
   * Opcional e não é fator de autenticação — o servidor guarda somente
   * o HMAC-SHA256 do valor, nunca o UUID cru.
   */
  @ApiPropertyOptional({
    example: '8f14e45f-ceea-467f-abE5-4c827b9a1c0d'.toLowerCase(),
    format: 'uuid',
    maxLength: 64,
  })
  @IsOptional()
  @IsUUID('4')
  @MaxLength(64)
  deviceId?: string;
}
