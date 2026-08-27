import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token de confirmação recebido por e-mail' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}