import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Alan Ferreira' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  fullName!: string;

  @ApiProperty({ example: 'alan@email.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '123.456.789-09' })
  @IsString()
  @Matches(/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/, {
    message: 'CPF inválido',
  })
  cpf!: string;

  @ApiProperty({ example: 'Flux2026x' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Senha deve conter letras e números',
  })
  password!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  acceptTerms!: boolean;
}
