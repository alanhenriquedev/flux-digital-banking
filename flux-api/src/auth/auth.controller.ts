import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Criar conta Flux' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Entrar na conta Flux' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceId: dto.deviceId,
    });
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Confirmar e-mail com o token recebido' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Reenviar e-mail de confirmação' })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Solicitar redefinição de senha' })
  @ApiResponse({ status: 201, description: 'Instruções enviadas (resposta genérica por segurança)' })
  @ApiResponse({ status: 400, description: 'E-mail inválido' })
  @ApiResponse({ status: 429, description: 'Muitas solicitações, aguarde' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Redefinir senha com o token recebido' })
  @ApiResponse({ status: 201, description: 'Senha redefinida com sucesso' })
  @ApiResponse({ status: 400, description: 'Token inválido, expirado ou já utilizado' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Alterar a senha do usuário logado (revoga todas as sessões)' })
  @ApiResponse({ status: 201, description: 'Senha alterada com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos, senha atual incorreta ou senhas não coincidem' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 429, description: 'Muitas tentativas, aguarde' })
  changePassword(
    @CurrentUser() user: { userId: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, dto);
  }

  @Post('email/change')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Solicitar troca de e-mail (envia confirmação para o novo endereço)' })
  @ApiResponse({ status: 201, description: 'Confirmação enviada para o novo e-mail' })
  @ApiResponse({ status: 400, description: 'Dados inválidos, senha incorreta ou e-mail igual ao atual' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado' })
  @ApiResponse({ status: 429, description: 'Muitas tentativas, aguarde' })
  requestEmailChange(
    @CurrentUser() user: { userId: string },
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.authService.requestEmailChange(user.userId, dto);
  }

  @Post('email/change/confirm')
  @ApiOperation({ summary: 'Confirmar a troca de e-mail com o token recebido' })
  @ApiResponse({ status: 201, description: 'E-mail alterado com sucesso' })
  @ApiResponse({ status: 400, description: 'Token inválido ou expirado' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado' })
  confirmEmailChange(@Body() dto: ConfirmEmailChangeDto) {
    return this.authService.confirmEmailChange(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil do usuário logado' })
  me(@CurrentUser() user: { userId: string }) {
    return this.authService.getProfile(user.userId);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Encerrar a sessão atual (revoga o sid do token)' })
  @ApiResponse({ status: 201, description: 'Sessão encerrada' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  logout(@CurrentUser() user: { userId: string; sid: string | null }) {
    return this.authService.logout(user);
  }
}
