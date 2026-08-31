import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma, SessionRevokedReason } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { AccountsService } from '../accounts/accounts.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SecurityService } from '../security/security.service';
import { AlertsService } from '../alerts/alerts.service';
import { LoginContext, summarizeUserAgent } from '../security/security.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { formatCpf, isValidCpf, normalizeCpf } from '../common/utils/cpf.util';

const RESEND_COOLDOWN_MS = 60_000;
const PASSWORD_RESET_COOLDOWN_MS = 60_000;
const PASSWORD_CHANGE_COOLDOWN_MS = 60_000;
const EMAIL_CHANGE_COOLDOWN_MS = 60_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(value.trim());
  if (!match) return 24 * 60 * 60 * 1000;

  const amount = Number(match[1]);
  const unit = (match[2] ?? 'h').toLowerCase();
  const multiplier: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * (multiplier[unit] ?? 3_600_000);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly lastResendAt = new Map<string, number>();
  private readonly lastPasswordResetRequestAt = new Map<string, number>();
  private readonly lastPasswordChangeFailAt = new Map<string, number>();
  private readonly lastEmailChangeFailAt = new Map<string, number>();

  constructor(
    private readonly usersService: UsersService,
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly security: SecurityService,
    private readonly alerts?: AlertsService,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.acceptTerms) {
      throw new BadRequestException('Você precisa aceitar os termos para continuar.');
    }

    const cpfDigits = normalizeCpf(dto.cpf);
    if (!isValidCpf(cpfDigits)) {
      throw new BadRequestException('CPF inválido.');
    }

    const email = dto.email.trim().toLowerCase();

    const [existingEmail, existingCpf] = await Promise.all([
      this.usersService.findByEmail(email),
      this.usersService.findByCpf(cpfDigits),
    ]);

    if (existingEmail) {
      throw new ConflictException('Este e-mail já está cadastrado.');
    }

    if (existingCpf) {
      throw new ConflictException('Este CPF já está cadastrado.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.usersService.create({
      fullName: dto.fullName.trim(),
      email,
      cpf: cpfDigits,
      passwordHash,
      acceptedTerms: dto.acceptTerms,
    });

    await this.accountsService.createForUser(user.id);

    const { token, hash } = this.generateVerificationToken();
    const expiresAt = new Date(Date.now() + this.verificationTtlMs());
    try {
      await this.mailService.sendVerificationEmail(user.email, user.fullName, token);
    } catch {
      throw new ServiceUnavailableException('Não foi possível enviar o e-mail de confirmação. Tente novamente.');
    }
    await this.usersService.setEmailVerifyToken(user.id, hash, expiresAt);

    return {
      message: 'Conta criada com sucesso. Enviamos um e-mail de confirmação para você.',
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        cpf: formatCpf(user.cpf),
      },
    };
  }

  async login(dto: LoginDto, request?: LoginContext) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Confirme seu e-mail para continuar.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const account = await this.accountsService.findByUserId(user.id);

    const session = await this.security.createSession(user.id, request);
    const payload = { sub: user.id, sid: session.id };
    const accessToken = await this.jwtService.signAsync(payload);

    // AUTH_LOGIN fica DESLIGADO por padrão (NOTIFY_LOGIN=false).
    // Ativo apenas em ambientes que optarem por isso explicitamente.
    const notifyLogin = (this.config.get<string>('NOTIFY_LOGIN') ?? 'false') === 'true';
    if (notifyLogin) {
      await this.notifications.safeCreate({
        userId: user.id,
        type: 'AUTH_LOGIN',
        title: 'Novo acesso na sua conta',
        message: `Login realizado em ${new Date().toLocaleString('pt-BR')}`,
      });
    }

    try {
      await this.security.safeCreateLoginRecord(user.id, request);
    } catch (err) {
      this.logger.error(
        `Falha ao registrar histórico de login para user ${user.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    // Lote 1 · Alertas de segurança (nunca interrompem o login)
    if (this.alerts) {
      try {
        await this.alerts.onLogin({
          userId: user.id,
          sessionId: session.id,
          deviceIdHash: session.deviceIdHash,
          deviceLabel: summarizeUserAgent(request?.userAgent ?? null),
          ip: request?.ip ?? null,
        });
      } catch (err) {
        this.logger.error(
          `Falha ao avaliar alertas de login para user ${user.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    return {
      accessToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        cpf: formatCpf(user.cpf),
      },
      account: account
        ? {
            id: account.id,
            agency: account.agency,
            number: account.number,
            balance: Number(account.balance),
          }
        : null,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.usersService.findByEmailVerifyToken(hashToken(dto.token));

    if (!user) {
      throw new BadRequestException('Link de confirmação inválido ou já utilizado.');
    }

    if (!user.emailVerifyTokenExpiry || user.emailVerifyTokenExpiry.getTime() < Date.now()) {
      throw new BadRequestException('Link de confirmação expirado. Solicite um novo e-mail.');
    }

    const consumed = await this.usersService.consumeEmailVerificationToken(
      hashToken(dto.token),
      new Date(),
    );
    if (consumed.count !== 1) {
      throw new BadRequestException('Link de confirmação inválido ou já utilizado.');
    }

    return { message: 'E-mail confirmado com sucesso.' };
  }

  async resendVerification(dto: ResendVerificationDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Este e-mail já foi confirmado.');
    }

    const previous = this.lastResendAt.get(user.id) ?? 0;
    const remaining = RESEND_COOLDOWN_MS - (Date.now() - previous);
    if (remaining > 0) {
      throw new HttpException(
        `Aguarde ${Math.ceil(remaining / 1000)} segundos para solicitar um novo e-mail.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { token, hash } = this.generateVerificationToken();
    const expiresAt = new Date(Date.now() + this.verificationTtlMs());
    try {
      await this.mailService.sendVerificationEmail(user.email, user.fullName, token);
    } catch {
      throw new ServiceUnavailableException('Não foi possível enviar o e-mail de confirmação. Tente novamente.');
    }
    await this.usersService.setEmailVerifyToken(user.id, hash, expiresAt);

    this.lastResendAt.set(user.id, Date.now());
    if (this.lastResendAt.size > 1000) {
      this.pruneResendCooldowns();
    }

    return { message: 'E-mail de confirmação enviado. Verifique sua caixa de entrada.' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();

    const previous = this.lastPasswordResetRequestAt.get(email) ?? 0;
    const remaining = PASSWORD_RESET_COOLDOWN_MS - (Date.now() - previous);
    if (remaining > 0) {
      throw new HttpException(
        `Aguarde ${Math.ceil(remaining / 1000)} segundos para tentar novamente.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.lastPasswordResetRequestAt.set(email, Date.now());
    if (this.lastPasswordResetRequestAt.size > 1000) {
      this.prunePasswordResetCooldowns();
    }

    const user = await this.usersService.findByEmail(email);

    if (user) {
      const { token, hash } = this.generatePasswordResetToken();
      const expiresAt = new Date(Date.now() + this.passwordResetTtlMs());
      try {
        await this.mailService.sendPasswordResetEmail(user.email, user.fullName, token);
      } catch {
        throw new ServiceUnavailableException('Não foi possível enviar as instruções de recuperação. Tente novamente.');
      }
      await this.usersService.setPasswordResetToken(user.id, hash, expiresAt);
    }

    return {
      message:
        'Se existir uma conta associada a este e-mail, enviaremos instruções para redefinir sua senha.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.usersService.findByPasswordResetToken(hashToken(dto.token));

    if (!user) {
      throw new BadRequestException('Link de redefinição inválido ou já utilizado.');
    }

    if (!user.passwordResetTokenExpiry || user.passwordResetTokenExpiry.getTime() < Date.now()) {
      throw new BadRequestException('Este link expirou. Solicite uma nova redefinição de senha.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const consumed = await this.usersService.consumePasswordResetToken(
      hashToken(dto.token),
      passwordHash,
      new Date(),
    );
    if (consumed.count !== 1) {
      throw new BadRequestException('Link de redefinição inválido ou já utilizado.');
    }

    try {
      await this.security.revokeAll(user.id, 'PASSWORD_CHANGED');
    } catch (err) {
      this.logger.error(
        `Falha ao revogar sessões após reset de senha do user ${user.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { message: 'Senha redefinida com sucesso.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const previousFailure = this.lastPasswordChangeFailAt.get(userId) ?? 0;
    const cooldownRemaining = PASSWORD_CHANGE_COOLDOWN_MS - (Date.now() - previousFailure);
    if (cooldownRemaining > 0) {
      throw new HttpException(
        `Aguarde ${Math.ceil(cooldownRemaining / 1000)} segundos para tentar novamente.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const credentials = await this.usersService.findPasswordHashById(userId);
    if (!credentials) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const currentPasswordMatch = await bcrypt.compare(dto.currentPassword, credentials.passwordHash);
    if (!currentPasswordMatch) {
      this.lastPasswordChangeFailAt.set(userId, Date.now());
      if (this.lastPasswordChangeFailAt.size > 1000) {
        this.prunePasswordChangeCooldowns();
      }
      throw new BadRequestException('Senha atual incorreta.');
    }

    const sameAsCurrent = await bcrypt.compare(dto.newPassword, credentials.passwordHash);
    if (sameAsCurrent) {
      throw new BadRequestException('A nova senha deve ser diferente da atual.');
    }

    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('As senhas não coincidem.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.usersService.updateUserPassword(userId, passwordHash);

    try {
      await this.security.revokeAll(userId, SessionRevokedReason.PASSWORD_CHANGED);
    } catch (err) {
      this.logger.error(
        `Falha ao revogar sessões após alteração de senha do user ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { message: 'Senha alterada com sucesso.' };
  }

  async requestEmailChange(userId: string, dto: RequestEmailChangeDto) {
    const previousFailure = this.lastEmailChangeFailAt.get(userId) ?? 0;
    const cooldownRemaining = EMAIL_CHANGE_COOLDOWN_MS - (Date.now() - previousFailure);
    if (cooldownRemaining > 0) {
      throw new HttpException(
        `Aguarde ${Math.ceil(cooldownRemaining / 1000)} segundos para tentar novamente.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const credentials = await this.usersService.findPasswordHashById(userId);
    if (!credentials) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const passwordMatch = await bcrypt.compare(dto.currentPassword, credentials.passwordHash);
    if (!passwordMatch) {
      this.lastEmailChangeFailAt.set(userId, Date.now());
      if (this.lastEmailChangeFailAt.size > 1000) {
        this.pruneEmailChangeCooldowns();
      }
      throw new BadRequestException('Senha atual incorreta.');
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const newEmail = dto.newEmail.trim().toLowerCase();
    if (newEmail === user.email) {
      throw new BadRequestException('O novo e-mail deve ser diferente do atual.');
    }

    const existing = await this.usersService.findByEmail(newEmail);
    if (existing) {
      throw new ConflictException('Este e-mail já está cadastrado.');
    }

    // Substitui qualquer pendência anterior (novo token, nova validade).
    const { token, hash } = this.generateVerificationToken();
    const expiresAt = new Date(Date.now() + this.verificationTtlMs());
    try {
      await this.mailService.sendEmailChangeConfirmationEmail(newEmail, user.fullName, token);
    } catch {
      throw new ServiceUnavailableException('Não foi possível enviar a confirmação para o novo e-mail. Tente novamente.');
    }
    await this.usersService.setPendingEmail(user.id, newEmail, hash, expiresAt);

    return { message: 'Confirmação enviada para o novo e-mail.' };
  }

  async confirmEmailChange(dto: ConfirmEmailChangeDto) {
    const user = await this.usersService.findUserByPendingEmailToken(hashToken(dto.token));

    if (!user || !user.pendingEmail) {
      throw new BadRequestException('Link de confirmação inválido ou já utilizado.');
    }

    if (!user.pendingEmailTokenExpiry || user.pendingEmailTokenExpiry.getTime() < Date.now()) {
      throw new BadRequestException('Este link expirou. Solicite uma nova troca de e-mail.');
    }

    // Revalida unicidade no momento da confirmação (janela de corrida).
    const existing = await this.usersService.findByEmail(user.pendingEmail);
    if (existing && existing.id !== user.id) {
      throw new ConflictException('Este e-mail já está cadastrado.');
    }

    try {
      // Swap atômico: troca o e-mail, confirma e limpa a pendência num único update.
      const consumed = await this.usersService.consumePendingEmailToken(
        user.id,
        user.pendingEmail,
        hashToken(dto.token),
        new Date(),
      );
      if (consumed.count !== 1) {
        throw new BadRequestException('Link de confirmação inválido ou já utilizado.');
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Este e-mail já está cadastrado.');
      }
      throw err;
    }

    return { message: 'E-mail alterado com sucesso.' };
  }

  async logout(user: { userId: string; sid: string | null }) {
    return this.security.revokeCurrent(user.sid, user.userId);
  }

  private generatePasswordResetToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, hash: hashToken(token) };
  }

  private passwordResetTtlMs(): number {
    const raw = this.config.get<string>('PASSWORD_RESET_EXPIRES_IN') ?? '30m';
    return parseDurationMs(raw);
  }

  private generateVerificationToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, hash: hashToken(token) };
  }

  private verificationTtlMs(): number {
    const raw = this.config.get<string>('EMAIL_VERIFY_EXPIRES_IN') ?? '24h';
    return parseDurationMs(raw);
  }

  private pruneResendCooldowns() {
    const cutoff = Date.now() - RESEND_COOLDOWN_MS;
    for (const [userId, timestamp] of this.lastResendAt) {
      if (timestamp < cutoff) {
        this.lastResendAt.delete(userId);
      }
    }
  }

  private prunePasswordResetCooldowns() {
    const cutoff = Date.now() - PASSWORD_RESET_COOLDOWN_MS;
    for (const [email, timestamp] of this.lastPasswordResetRequestAt) {
      if (timestamp < cutoff) {
        this.lastPasswordResetRequestAt.delete(email);
      }
    }
  }

  private prunePasswordChangeCooldowns() {
    const cutoff = Date.now() - PASSWORD_CHANGE_COOLDOWN_MS;
    for (const [userId, timestamp] of this.lastPasswordChangeFailAt) {
      if (timestamp < cutoff) {
        this.lastPasswordChangeFailAt.delete(userId);
      }
    }
  }

  private pruneEmailChangeCooldowns() {
    const cutoff = Date.now() - EMAIL_CHANGE_COOLDOWN_MS;
    for (const [userId, timestamp] of this.lastEmailChangeFailAt) {
      if (timestamp < cutoff) {
        this.lastEmailChangeFailAt.delete(userId);
      }
    }
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const account = await this.accountsService.findByUserId(userId);

    return {
      user: {
        ...user,
        cpf: formatCpf(user.cpf),
      },
      account: account
        ? {
            id: account.id,
            agency: account.agency,
            number: account.number,
            balance: Number(account.balance),
          }
        : null,
    };
  }
}
