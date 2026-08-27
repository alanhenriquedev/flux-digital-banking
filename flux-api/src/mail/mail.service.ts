import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('MAIL_HOST') ?? 'localhost';
    const port = Number(this.config.get<string>('MAIL_PORT') ?? 1025);
    const user = this.config.get<string>('MAIL_USER') ?? '';
    const pass = this.config.get<string>('MAIL_PASS') ?? '';
    const secure = (this.config.get<string>('MAIL_SECURE') ?? 'false') === 'true';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  async sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
    const frontendUrl = (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5500').replace(/\/+$/, '');
    const link = `${frontendUrl}/verificar_email.html?token=${encodeURIComponent(token)}`;

    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('MAIL_FROM') ?? 'Flux <noreply@flux.local>',
        to,
        subject: 'Confirme seu e-mail no Flux',
        html: this.buildVerificationTemplate(name, link),
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de confirmação para ${to}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private buildVerificationTemplate(name: string, link: string): string {
    return `
<div style="background:#090b0f; margin:0; padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090b0f;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px; width:100%;">
          <tr>
            <td style="padding-bottom:24px; text-align:center;">
              <span style="display:inline-block; width:26px; height:26px; border-radius:9px; vertical-align:middle;
                background:linear-gradient(135deg,#3ee8ff 0%,#0a84ff 100%);"></span>
              <span style="font-family:'Space Grotesk',Arial,sans-serif; font-weight:700; font-size:22px;
                color:#f2f5f9; letter-spacing:0.5px; vertical-align:middle; margin-left:8px;">FLUX</span>
            </td>
          </tr>
          <tr>
            <td style="background:#141922; border:1px solid #232a36; border-radius:20px; padding:36px 32px;">
              <p style="margin:0 0 14px; font-family:Arial,sans-serif; font-size:12px; color:#22c8f5;
                font-weight:bold; letter-spacing:2px; text-transform:uppercase;">Flux</p>
              <h1 style="margin:0 0 16px; font-family:Arial,sans-serif; font-size:24px; color:#f2f5f9;">
                Confirme seu e-mail
              </h1>
              <p style="margin:0 0 20px; font-family:Arial,sans-serif; font-size:15px; line-height:1.65; color:#9aa4b4;">
                Olá, <strong style="color:#f2f5f9;">${name}</strong>. Sua conta Flux foi criada com sucesso.
                Para liberar o acesso, confirme agora o seu endereço de e-mail.
              </p>
              <div style="text-align:center; margin:28px 0;">
                <a href="${link}" style="display:inline-block; font-family:Arial,sans-serif; font-size:15px;
                  font-weight:700; color:#04121a; text-decoration:none; padding:14px 32px; border-radius:100px;
                  background:linear-gradient(135deg,#3ee8ff 0%,#0a84ff 100%);">Confirmar meu e-mail</a>
              </div>
              <p style="margin:0; font-family:Arial,sans-serif; font-size:13px; color:#9aa4b4; text-align:center;">
                O link é válido por <strong style="color:#f2f5f9;">24 horas</strong> e só pode ser usado uma vez.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:20px; text-align:center; font-family:Arial,sans-serif; font-size:12px; color:#5c6577;">
              Se você não criou esta conta, pode ignorar este e-mail.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>
`;
  }

  async sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
    const frontendUrl = (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5500').replace(/\/+$/, '');
    const link = `${frontendUrl}/redefinir_senha.html?token=${encodeURIComponent(token)}`;

    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('MAIL_FROM') ?? 'Flux <noreply@flux.local>',
        to,
        subject: 'Redefina sua senha no Flux',
        html: this.buildPasswordResetTemplate(name, link),
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de redefinição de senha para ${to}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }

  private buildPasswordResetTemplate(name: string, link: string): string {
    return `
<div style="background:#090b0f; margin:0; padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090b0f;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px; width:100%;">
          <tr>
            <td style="padding-bottom:24px; text-align:center;">
              <span style="display:inline-block; width:26px; height:26px; border-radius:9px; vertical-align:middle;
                background:linear-gradient(135deg,#3ee8ff 0%,#0a84ff 100%);"></span>
              <span style="font-family:'Space Grotesk',Arial,sans-serif; font-weight:700; font-size:22px;
                color:#f2f5f9; letter-spacing:0.5px; vertical-align:middle; margin-left:8px;">FLUX</span>
            </td>
          </tr>
          <tr>
            <td style="background:#141922; border:1px solid #232a36; border-radius:20px; padding:36px 32px;">
              <p style="margin:0 0 14px; font-family:Arial,sans-serif; font-size:12px; color:#22c8f5;
                font-weight:bold; letter-spacing:2px; text-transform:uppercase;">Flux</p>
              <h1 style="margin:0 0 16px; font-family:Arial,sans-serif; font-size:24px; color:#f2f5f9;">
                Redefina sua senha
              </h1>
              <p style="margin:0 0 20px; font-family:Arial,sans-serif; font-size:15px; line-height:1.65; color:#9aa4b4;">
                Olá, <strong style="color:#f2f5f9;">${name}</strong>. Recebemos uma solicitação para redefinir
                a senha da sua conta Flux. Para continuar, clique no botão abaixo.
              </p>
              <div style="text-align:center; margin:28px 0;">
                <a href="${link}" style="display:inline-block; font-family:Arial,sans-serif; font-size:15px;
                  font-weight:700; color:#04121a; text-decoration:none; padding:14px 32px; border-radius:100px;
                  background:linear-gradient(135deg,#3ee8ff 0%,#0a84ff 100%);">Redefinir minha senha</a>
              </div>
              <p style="margin:0; font-family:Arial,sans-serif; font-size:13px; color:#9aa4b4; text-align:center;">
                O link é válido por <strong style="color:#f2f5f9;">30 minutos</strong> e só pode ser usado uma vez.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:20px; text-align:center; font-family:Arial,sans-serif; font-size:12px; color:#5c6577;">
              Se você não solicitou a redefinição de senha, pode ignorar este e-mail.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>
`;
  }

  async sendEmailChangeConfirmationEmail(to: string, name: string, token: string): Promise<void> {
    const frontendUrl = (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5500').replace(/\/+$/, '');
    const link = `${frontendUrl}/confirmar_email.html?token=${encodeURIComponent(token)}`;

    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('MAIL_FROM') ?? 'Flux <noreply@flux.local>',
        to,
        subject: 'Confirme seu novo e-mail no Flux',
        html: this.buildEmailChangeTemplate(name, link),
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de confirmação de troca para ${to}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private buildEmailChangeTemplate(name: string, link: string): string {
    return `
<div style="background:#090b0f; margin:0; padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090b0f;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px; width:100%;">
          <tr>
            <td style="padding-bottom:24px; text-align:center;">
              <span style="display:inline-block; width:26px; height:26px; border-radius:9px; vertical-align:middle;
                background:linear-gradient(135deg,#3ee8ff 0%,#0a84ff 100%);"></span>
              <span style="font-family:'Space Grotesk',Arial,sans-serif; font-weight:700; font-size:22px;
                color:#f2f5f9; letter-spacing:0.5px; vertical-align:middle; margin-left:8px;">FLUX</span>
            </td>
          </tr>
          <tr>
            <td style="background:#141922; border:1px solid #232a36; border-radius:20px; padding:36px 32px;">
              <p style="margin:0 0 14px; font-family:Arial,sans-serif; font-size:12px; color:#22c8f5;
                font-weight:bold; letter-spacing:2px; text-transform:uppercase;">Flux</p>
              <h1 style="margin:0 0 16px; font-family:Arial,sans-serif; font-size:24px; color:#f2f5f9;">
                Confirme seu novo e-mail
              </h1>
              <p style="margin:0 0 20px; font-family:Arial,sans-serif; font-size:15px; line-height:1.65; color:#9aa4b4;">
                Olá, <strong style="color:#f2f5f9;">${name}</strong>. Recebemos uma solicitação para alterar
                o e-mail da sua conta Flux para este endereço. Para concluir a troca, clique no botão abaixo.
              </p>
              <div style="text-align:center; margin:28px 0;">
                <a href="${link}" style="display:inline-block; font-family:Arial,sans-serif; font-size:15px;
                  font-weight:700; color:#04121a; text-decoration:none; padding:14px 32px; border-radius:100px;
                  background:linear-gradient(135deg,#3ee8ff 0%,#0a84ff 100%);">Confirmar novo e-mail</a>
              </div>
              <p style="margin:0; font-family:Arial,sans-serif; font-size:13px; color:#9aa4b4; text-align:center;">
                O link é válido por <strong style="color:#f2f5f9;">24 horas</strong> e só pode ser usado uma vez.
                Até lá, seu e-mail atual continua funcionando normalmente.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:20px; text-align:center; font-family:Arial,sans-serif; font-size:12px; color:#5c6577;">
              Se você não solicitou esta alteração, pode ignorar este e-mail — sua conta permanece com o e-mail atual.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>
`;
  }
}