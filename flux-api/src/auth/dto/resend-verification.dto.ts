import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendVerificationDto {
  @ApiProperty({ example: 'alan@email.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Flux2026x' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}