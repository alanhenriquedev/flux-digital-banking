import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestEmailChangeDto {
  @ApiProperty({ example: 'novo@email.com' })
  @IsString()
  @IsEmail({}, { message: 'E-mail inválido.' })
  newEmail!: string;

  @ApiProperty({ example: 'Flux2026x' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
