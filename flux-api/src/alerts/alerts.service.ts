import { Injectable, Logger } from '@nestjs/common';
import { AlertKind, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';

interface CatalogEntry {
  kind: AlertKind;
  category: 'SECURITY' | 'MOVEMENT' | 'ACCOUNT';
  label: string;
  description: string;
  hasThreshold: boolean;
  defaultThreshold: number | null;
}

const CATALOG: CatalogEntry[] = [
  {
    kind: 'NEW_DEVICE_LOGIN', category: 'SECURITY',
    label: 'Login em novo dispositivo',
    description: 'Avisa quando um acesso é feito de um navegador/dispositivo novo.',
    hasThreshold: false, defaultThreshold: null,
  },
  {
    kind: 'SUSPICIOUS_LOGIN', category: 'SECURITY',
    label: 'Acesso suspeito',
    description: 'Avisa quando um dispositivo conhecido entra de uma rede diferente do último acesso dele.',
    hasThreshold: false, defaultThreshold: null,
  },
  {
    kind: 'PIX_ABOVE', category: 'MOVEMENT',
    label: 'PIX acima de determinado valor',
    description: 'Dispara quando um PIX enviado/recebido atinge o limiar configurado.',
    hasThreshold: true, defaultThreshold: 1000,
  },
  {
    kind: 'BALANCE_BELOW', category: 'MOVEMENT',
    label: 'Saldo abaixo de determinado valor',
    description: 'Dispara quando o saldo disponível fica abaixo do limiar após uma movimentação.',
    hasThreshold: true, defaultThreshold: 100,
  },
  {
    kind: 'PIX_SENT', category: 'MOVEMENT',
    label: 'PIX realizado (enviado)',
    description: 'Notifica cada PIX enviado pela conta.',
    hasThreshold: false, defaultThreshold: null,
  },
  {
    kind: 'PIX_RECEIVED', category: 'MOVEMENT',
    label: 'PIX recebido',
    description: 'Notifica cada PIX recebido na conta.',
    hasThreshold: false, defaultThreshold: null,
  },
  {
    kind: 'LOAN_CONTRACTED', category: 'ACCOUNT',
    label: 'Empréstimo contratado',
    description: 'Confirma a contratação e liberação de um empréstimo.',
    hasThreshold: false, defaultThreshold: null,
  },
  {
    kind: 'LOAN_INSTALLMENT_DUE', category: 'ACCOUNT',
    label: 'Parcela próxima do vencimento',
    description: 'Lembra quando houver parcela vencendo nos próximos dias.',
    hasThreshold: false, defaultThreshold: null,
  },
];

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================================
  // Catálogo / preferências
  // ============================================================
  static catalog(): CatalogEntry[] {
    return CATALOG;
  }

  async getSettings(userId: string) {
    const rows = await this.prisma.alertSetting.findMany({ where: { userId } });
    const byKind = new Map(rows.map((r) => [r.kind as string, r]));

    return {
      items: CATALOG.map((c) => {
        const row = byKind.get(c.kind);
        return {
          kind: c.kind,
          category: c.category,
          label: c.label,
          description: c.description,
          hasThreshold: c.hasThreshold,
          enabled: row ? row.enabled : true,
          threshold:
            c.hasThreshold
              ? Number(row?.threshold ?? c.defaultThreshold)
              : null,
          customThreshold: row?.threshold != null,
        };
      }),
    };
  }

  async isEnabled(userId: string, kind: AlertKind): Promise<boolean> {
    try {
      const row = await this.prisma.alertSetting.findUnique({
        where: { userId_kind: { userId, kind } },
        select: { enabled: true },
      });
      return row ? row.enabled : true;
    } catch (err) {
      this.logger.warn(`isEnabled(${kind}) falhou; assumindo habilitado`, err instanceof Error ? err.message : String(err));
      return true;
    }
  }

  async updateSetting(userId: string, kind: AlertKind, patch: { enabled?: boolean; threshold?: number | null }) {
    const entry = CATALOG.find((c) => c.kind === kind);
    if (!entry) throw new Error('unknown-kind');

    const data: Record<string, unknown> = {};
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (entry.hasThreshold && patch.threshold !== undefined) {
      data.threshold = patch.threshold === null ? null : new Prisma.Decimal(patch.threshold.toFixed(2));
    }

    await this.prisma.alertSetting.upsert({
      where: { userId_kind: { userId, kind } },
      create: {
        userId,
        kind,
        enabled: patch.enabled ?? true,
        threshold:
          entry.hasThreshold && patch.threshold !== undefined
            ? patch.threshold === null
              ? null
              : new Prisma.Decimal(patch.threshold.toFixed(2))
            : entry.defaultThreshold != null
              ? new Prisma.Decimal(entry.defaultThreshold.toFixed(2))
              : null,
      },
      update: data,
    });

    return { message: 'Preferência salva.', kind };
  }

  // ============================================================
  // Despacho — nunca lança; respeita preferência e deduplica.
  // ============================================================
  private async dispatch(opts: {
    userId: string;
    kind: AlertKind;
    dedupKey: string;
    title: string;
    message?: string;
    amount?: number;
    entityType?: string;
    entityId?: string;
    gateAmount?: number;
    gateBalanceAfter?: number;
  }): Promise<boolean> {
    try {
      if (!(await this.isEnabled(opts.userId, opts.kind))) return false;

      const entry = CATALOG.find((c) => c.kind === opts.kind)!;
      if (opts.gateAmount !== undefined || opts.gateBalanceAfter !== undefined) {
        const row = await this.prisma.alertSetting.findUnique({
          where: { userId_kind: { userId: opts.userId, kind: opts.kind } },
          select: { threshold: true },
        });
        const th =
          row?.threshold != null
            ? Number(row.threshold)
            : entry.defaultThreshold ?? 0;

        if (opts.gateAmount !== undefined && !(opts.gateAmount >= th)) return false;
        if (opts.gateBalanceAfter !== undefined && !(opts.gateBalanceAfter <= th)) return false;
      }

      const type: NotificationType =
        entry.category === 'SECURITY'
          ? 'ALERT_SECURITY'
          : entry.category === 'MOVEMENT'
            ? 'ALERT_MOVEMENT'
            : 'ALERT_ACCOUNT';

      try {
        return await this.notifications.safeCreate({
          userId: opts.userId,
          type,
          title: opts.title,
          message: opts.message ?? null,
          ...(opts.amount == null ? {} : { amount: new Prisma.Decimal(opts.amount) }),
          entityType: opts.entityType ?? null,
          entityId: opts.entityId ?? null,
          dedupKey: opts.dedupKey,
        });
      } catch (err) {
        throw err;
      }
    } catch (err) {
      this.logger.error(
        `Falha ao despachar alerta ${opts.kind} para user ${opts.userId}`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }

  // ============================================================
  // Regras concretas
  // ============================================================
  /** Login: novo dispositivo e/ou dispositivo conhecido em rede nova. */
  async onLogin(ctx: {
    userId: string;
    sessionId: string;
    deviceIdHash: string | null;
    deviceLabel: string | null;
    ip: string | null;
  }): Promise<void> {
    try {
      if (!ctx.deviceIdHash) return; // sem deviceId não há como classificar

      const previous = await this.prisma.authSession.findMany({
        where: {
          userId: ctx.userId,
          id: { not: ctx.sessionId },
          deviceIdHash: { not: null },
        },
        orderBy: [{ createdAt: 'desc' }],
        select: { deviceIdHash: true, ip: true },
        take: 50,
      });

      const knownHashes = [...new Set(previous.map((s) => s.deviceIdHash as string))];
      const isNewDevice = !knownHashes.includes(ctx.deviceIdHash);

      if (isNewDevice && knownHashes.length > 0) {
        await this.dispatch({
          userId: ctx.userId,
          kind: 'NEW_DEVICE_LOGIN',
          dedupKey: `login:${ctx.sessionId}`,
          title: 'Novo dispositivo conectou à sua conta',
          message: ctx.deviceLabel ? `${ctx.deviceLabel} fez login agora.` : 'Um novo navegador fez login agora.',
          entityType: 'auth_session',
          entityId: ctx.sessionId,
        });
        return; // novo device já informa a novidade principal
      }

      if (!isNewDevice) {
        const sameHashLast = previous.find((s) => s.deviceIdHash === ctx.deviceIdHash);
        const lastPrefix = ipPrefix(sameHashLast?.ip ?? null);
        const nowPrefix = ipPrefix(ctx.ip);
        if (lastPrefix && nowPrefix && lastPrefix !== nowPrefix) {
          await this.dispatch({
            userId: ctx.userId,
            kind: 'SUSPICIOUS_LOGIN',
            dedupKey: `susp:${ctx.sessionId}`,
            title: 'Acesso de rede diferente do habitual',
            message: `${ctx.deviceLabel ?? 'Seu dispositivo'} entrou de uma rede distinta da última vez.`,
            entityType: 'auth_session',
            entityId: ctx.sessionId,
          });
        }
      }
    } catch (err) {
      this.logger.error(
        `onLogin falhou para user ${ctx.userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async onPixSent(opts: {
    userId: string;
    txId: string;
    amount: number;
    counterpartyName: string;
    counterpartyNumber: string;
    balanceAfter: number | null;
    balanceBefore?: number | null;
  }): Promise<void> {
    // A notificação clássica de PIX enviado vive no TransactionsService
    // (gated por PIX_SENT). Aqui ficam apenas os alertas com limiar.
    await this.dispatch({
      userId: opts.userId,
      kind: 'PIX_ABOVE',
      dedupKey: `pixabove:${opts.txId}`,
      gateAmount: opts.amount,
      title: `PIX acima do seu limite: ${formatBRL(opts.amount)} enviado`,
      message: `Enviado para ${opts.counterpartyName} · conta ${opts.counterpartyNumber}`,
      amount: opts.amount,
      entityType: 'transaction',
      entityId: opts.txId,
    });
    if (opts.balanceAfter != null) await this.onBalanceChanged({
      userId: opts.userId,
      before: opts.balanceBefore ?? null,
      after: opts.balanceAfter,
      entityId: opts.txId,
    });
  }

  async onBalanceChanged(opts: {
    userId: string;
    before: number | null;
    after: number;
    entityType?: string;
    entityId?: string;
  }, retry = 0): Promise<void> {
    try {
      if (!this.prisma.alertState) {
        if (opts.after <= 100 && (opts.before == null || opts.before > 100)) {
          await this.dispatch({
            userId: opts.userId, kind: 'BALANCE_BELOW',
            dedupKey: `ballow:${opts.entityId ?? Date.now()}`,
            gateBalanceAfter: opts.after,
            title: `Saldo abaixo do seu limite: ${formatBRL(opts.after)}`,
            message: 'Considere revisar seus gastos ou pausar metas temporariamente.',
            amount: opts.after,
          });
        }
        return;
      }

      const setting = await this.prisma.alertSetting.findUnique({
        where: { userId_kind: { userId: opts.userId, kind: 'BALANCE_BELOW' } },
        select: { enabled: true, threshold: true },
      });
      const threshold = Number(setting?.threshold ?? 100);
      let risingEdge = false;

      await this.prisma.$transaction(async (tx) => {
        const state = await tx.alertState.findUnique({
          where: { userId_kind: { userId: opts.userId, kind: 'BALANCE_BELOW' } },
        });
        const crossed = opts.before != null && opts.before > threshold && opts.after <= threshold;
        if (!state) {
          await tx.alertState.create({
            data: { userId: opts.userId, kind: 'BALANCE_BELOW', threshold, isBelow: opts.after <= threshold },
          });
          risingEdge = crossed;
          return;
        }
        if (Number(state.threshold) !== threshold) {
          await tx.alertState.update({
            where: { id: state.id },
            data: { threshold, isBelow: opts.after <= threshold },
          });
          // A new threshold creates a new condition even if the balance was
          // already below the previous threshold.
          risingEdge = opts.after <= threshold;
          return;
        }
        if (opts.after > threshold) {
          await tx.alertState.update({ where: { id: state.id }, data: { isBelow: false } });
        } else if (!state.isBelow && crossed) {
          const claimed = await tx.alertState.updateMany({
            where: { id: state.id, isBelow: false },
            data: { isBelow: true },
          });
          risingEdge = claimed.count === 1;
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (risingEdge && setting?.enabled !== false) {
        await this.dispatch({
          userId: opts.userId, kind: 'BALANCE_BELOW',
          dedupKey: `ballow:${opts.entityId ?? Date.now()}`,
          gateBalanceAfter: opts.after,
          title: `Saldo abaixo do seu limite: ${formatBRL(opts.after)}`,
          message: 'Considere revisar seus gastos ou pausar metas temporariamente.',
          amount: opts.after,
        });
      }
    } catch (err) {
      if (retry < 2 && isRetryableTransactionError(err)) {
        await this.onBalanceChanged(opts, retry + 1);
        return;
      }
      this.logger.error(`onBalanceChanged falhou para user ${opts.userId}`, err instanceof Error ? err.stack : String(err));
    }
  }

  async onPixReceived(opts: {
    userId: string;
    txId: string;
    amount: number;
    counterpartyName: string;
    counterpartyNumber: string;
  }): Promise<void> {
    if (!(await this.isEnabled(opts.userId, 'PIX_RECEIVED'))) return;
    await this.notifications.safeCreate({
      userId: opts.userId,
      type: 'PIX_IN',
      title: `PIX de ${formatBRL(opts.amount)} recebido de ${opts.counterpartyName}`,
      message: `Conta ${opts.counterpartyNumber}`,
      amount: opts.amount,
      entityType: 'transaction',
      entityId: opts.txId,
    });
  }

  async onLoanContracted(opts: {
    userId: string;
    loanId: string;
    installments: number;
    installmentValue: number;
  }): Promise<void> {
    await this.dispatch({
      userId: opts.userId,
      kind: 'LOAN_CONTRACTED',
      dedupKey: `loan:${opts.loanId}`,
      title: 'Empréstimo contratado',
      message: `${opts.installments}x de ${formatBRL(opts.installmentValue)}. Acompanhe as parcelas na área de empréstimos.`,
      entityType: 'loan',
      entityId: opts.loanId,
    });
  }

  /** Lembrete lazy: chamado em interações de empréstimo do próprio usuário. */
  async checkInstallmentDue(userId: string): Promise<void> {
    try {
      if (!(await this.isEnabled(userId, 'LOAN_INSTALLMENT_DUE'))) return;

      const limitDate = new Date(Date.now() + 3 * 864e5);
      const target = await this.prisma.loanInstallment.findFirst({
        where: {
          loan: { userId },
          status: { in: ['PENDING' as const, 'OVERDUE' as const] },
          dueDate: { lte: limitDate },
        },
        orderBy: { dueDate: 'asc' },
      });
      if (!target) return;

      await this.dispatch({
        userId,
        kind: 'LOAN_INSTALLMENT_DUE',
        dedupKey: `due:${target.id}`,
        title: 'Parcela vencendo em breve',
        message: `Uma parcela de ${formatBRL(Number(target.amount))} vence em ${formatDateBR(target.dueDate)}.`,
        amount: Number(target.amount),
        entityType: 'loan_installment',
        entityId: target.id,
      });
    } catch (err) {
      this.logger.error(
        `checkInstallmentDue falhou para user ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

function isRetryableTransactionError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2002' || err.code === 'P2034');
}

function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const mapped = /^.*:ffff:(?<v4>\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)?.groups?.v4 ?? ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(mapped)) {
    const parts = mapped.split('.');
    return `${parts[0]}.${parts[1]}`;
  }
  const groups = mapped.split(':').filter(Boolean);
  return groups.slice(0, 2).join(':');
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDateBR(d: Date): string {
  function p(n: number) { return (n < 10 ? '0' : '') + n; }
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
