import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token de redefinição recebido por e-mail' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'Flux2026x' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Senha deve conter letras e números',
  })
  password!: string;
}