import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'SenhaAntiga1' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ example: 'Flux2026x' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Senha deve conter letras e números',
  })
  newPassword!: string;

  @ApiProperty({ example: 'Flux2026x' })
  @IsString()
  @IsNotEmpty()
  confirmNewPassword!: string;
}
