import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../alerts/alerts.service';
import { SendPixDto } from './dto/send-pix.dto';
import { ListTransactionsQuery } from './dto/list-transactions.query';

const PIX_MAX_AMOUNT = new Prisma.Decimal('100000.00');

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly alerts?: AlertsService,
  ) {}

  async sendPix(userId: string, dto: SendPixDto) {
    const amount = new Prisma.Decimal(dto.amount.toFixed(2));
    if (amount.lte(0)) {
      throw new BadRequestException('Valor deve ser maior que zero.');
    }
    if (amount.gt(PIX_MAX_AMOUNT)) {
      throw new BadRequestException('Valor acima do limite permitido para um PIX.');
    }

    const accountNumber = dto.accountNumber.trim();
    const description = dto.description?.trim() || null;
    const operationHash = hashOperation({ accountNumber, amount: amount.toString(), description });

    const [sender, recipient] = await Promise.all([
      this.prisma.account.findUnique({
        where: { userId },
        include: { user: { select: { id: true, fullName: true } } },
      }),
      this.prisma.account.findUnique({
        where: { number: accountNumber },
        include: { user: { select: { id: true, fullName: true } } },
      }),
    ]);

    if (!sender) {
      throw new NotFoundException('Conta de origem não encontrada.');
    }

    if (sender.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Sua conta está bloqueada.');
    }

    if (!recipient) {
      throw new NotFoundException('Conta de destino não encontrada.');
    }

    if (recipient.id === sender.id) {
      throw new ConflictException('Você não pode enviar um PIX para a sua própria conta.');
    }

    if (recipient.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('A conta de destino está bloqueada.');
    }

    if (dto.idempotencyKey) {
      const previous = await this.prisma.transaction.findFirst({
        where: { accountId: sender.id, idempotencyKey: dto.idempotencyKey },
      });
      if (previous) return this.replayPix(previous, operationHash);
    }

    // ids reais das transações, usados como entityId das notificações
    let outTx: { id: string } | null = null;
    let inTx: { id: string } | null = null;
    let movement: { before: number; after: number };

    try {
      movement = await this.prisma.$transaction(
        async (tx) => {
        const senderBefore = await tx.account.findUnique({ where: { id: sender.id }, select: { balance: true } });
        const debit = await tx.account.updateMany({
          where: {
            id: sender.id,
            status: 'ACTIVE',
            balance: { gte: amount },
          },
          data: {
            balance: { decrement: amount },
          },
        });

        if (debit.count !== 1) {
          throw new UnprocessableEntityException('Saldo insuficiente.');
        }

        const recipientNow = await tx.account.findUnique({
          where: { id: recipient.id },
          select: { status: true },
        });
        if (!recipientNow || recipientNow.status !== 'ACTIVE') {
          throw new UnprocessableEntityException('A conta de destino está bloqueada.');
        }

        await tx.account.update({
          where: { id: recipient.id },
          data: { balance: { increment: amount } },
        });

        outTx = await tx.transaction.create({
          data: {
            accountId: sender.id,
            type: 'PIX',
            direction: 'OUT',
            status: 'COMPLETED',
            amount,
            description,
            counterpartyName: recipient.user.fullName,
            counterpartyNumber: recipient.number,
            idempotencyKey: dto.idempotencyKey,
            idempotencyHash: operationHash,
          },
        });

        inTx = await tx.transaction.create({
          data: {
            accountId: recipient.id,
            type: 'PIX',
            direction: 'IN',
            status: 'COMPLETED',
            amount,
            description,
            counterpartyName: sender.user.fullName,
            counterpartyNumber: sender.number,
          },
        });
        return { before: Number(senderBefore?.balance ?? 0), after: Number(senderBefore?.balance ?? 0) - Number(amount) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (err) {
      if (dto.idempotencyKey && isUniqueViolation(err)) {
        const previous = await this.prisma.transaction.findFirst({
          where: { accountId: sender.id, idempotencyKey: dto.idempotencyKey },
        });
        if (previous) return this.replayPix(previous, operationHash);
      }
      throw err;
    }

    // Notificações — criadas DEPOIS do commit da operação financeira.
    // Lote 1: respeitam as preferências de alertas do usuário e nunca
    // revertem o PIX. Falhas são capturadas/logadas pelos serviços.
    if (!this.alerts || (await this.alerts.isEnabled(userId, 'PIX_SENT'))) {
      await this.notifications.safeCreate({
        userId,
        type: 'PIX_OUT',
        title: `PIX de ${formatBRL(amount)} enviado para ${recipient.user.fullName}`,
        message: `Conta ${recipient.number}${description ? ' · ' + description : ''}`,
        amount: Number(amount),
        entityType: 'transaction',
        entityId: outTx!.id,
        dedupKey: `pix-out:${outTx!.id}`,
      });
    }
    if (!this.alerts || (await this.alerts.isEnabled(recipient.user.id, 'PIX_RECEIVED'))) {
      await this.notifications.safeCreate({
        userId: recipient.user.id,
        type: 'PIX_IN',
        title: `PIX de ${formatBRL(amount)} recebido de ${sender.user.fullName}`,
        message: `Conta ${sender.number}${description ? ' · ' + description : ''}`,
        amount: Number(amount),
        entityType: 'transaction',
        entityId: inTx!.id,
        dedupKey: `pix-in:${inTx!.id}`,
      });
    }

    // Alertas com limiar (acima de X / saldo abaixo de Y) — pós-commit
    if (this.alerts) {
      try {
        await this.alerts.onPixSent({
          userId,
          txId: outTx!.id,
          amount: Number(amount),
          counterpartyName: recipient.user.fullName,
          counterpartyNumber: recipient.number,
          balanceBefore: movement.before,
          balanceAfter: movement.after,
        });
      } catch {
        /* best-effort */
      }
    }

    return {
      message: 'PIX enviado com sucesso.',
      amount: Number(amount),
      to: {
        number: recipient.number,
        name: recipient.user.fullName,
      },
    };
  }

  private async replayPix(previous: {
    id: string;
    idempotencyHash: string | null;
    amount: Prisma.Decimal;
    counterpartyName: string | null;
    counterpartyNumber: string | null;
  }, operationHash: string) {
    if (previous.idempotencyHash !== operationHash) {
      throw new ConflictException('A chave de idempotência já foi usada com outro PIX.');
    }
    return {
      message: 'PIX enviado com sucesso.',
      amount: Number(previous.amount),
      to: { number: previous.counterpartyNumber, name: previous.counterpartyName },
    };
  }

  async listForAccount(userId: string, query: ListTransactionsQuery) {
    const account = await this.prisma.account.findUnique({
      where: { userId },
    });
    if (!account) {
      throw new NotFoundException('Conta não encontrada.');
    }

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.transaction.count({ where: { accountId: account.id } }),
      this.prisma.transaction.findMany({
        where: { accountId: account.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        type: t.type,
        direction: t.direction,
        status: t.status,
        amount: Number(t.amount),
        description: t.description,
        counterpartyName: t.counterpartyName,
        counterpartyNumber: t.counterpartyNumber,
        createdAt: t.createdAt,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

function hashOperation(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function formatBRL(value: Prisma.Decimal | number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value));
}
