import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { ListNotificationsQuery } from './dto/list-notifications.query';

export interface CreateNotificationData {
  userId: string;
  type: NotificationType;
  title: string;
  message?: string | null;
  amount?: Prisma.Decimal | number | string;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * Chave de idempotência/anti-spam (Lote 1 · Alertas).
   * Único por usuário — um segundo create com a mesma chave falha
   * com P2002 e é tratado pelo emissor como "já notificado".
   */
  dedupKey?: string | null;
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private retryTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.retryTimer = setInterval(() => { void this.processOutbox(); }, 30_000);
    void this.processOutbox();
  }

  onModuleDestroy() {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  /**
   * Cria uma notificação para um usuário.
   * Método interno reutilizável pelos emitters (PIX, cartão, login, fatura).
   */
  async createNotification(data: CreateNotificationData): Promise<Notification> {
    const amount =
      data.amount == null
        ? null
        : new Prisma.Decimal(String(data.amount));

    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message ?? null,
        amount,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        dedupKey: data.dedupKey ?? null,
      },
    });
  }

  /**
   * Criação segura para os emitters: qualquer falha é capturada e logada,
   * mas NUNCA propagada — uma notificação quebrada não pode reverter ou
   * interromper a operação financeira que a originou.
   */
  async safeCreate(data: CreateNotificationData): Promise<boolean> {
    const reliable = { ...data, dedupKey: data.dedupKey ?? stableDedupKey(data) };
    try {
      await this.createNotification(reliable);
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      try {
        await this.prisma.notificationOutbox.create({
          data: {
            userId: reliable.userId,
            type: reliable.type,
            title: reliable.title,
            message: reliable.message ?? null,
            amount: reliable.amount == null ? null : new Prisma.Decimal(String(reliable.amount)),
            entityType: reliable.entityType ?? null,
            entityId: reliable.entityId ?? null,
            dedupKey: reliable.dedupKey!,
          },
        });
        return true;
      } catch (outboxErr) {
        this.logger.error('Falha ao enfileirar notificação para reprocessamento', outboxErr instanceof Error ? outboxErr.stack : String(outboxErr));
      }
      this.logger.error(
        `Falha ao criar notificação (${reliable.type}) para user ${reliable.userId}: ${reliable.title}`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }

  private async processOutbox(): Promise<void> {
    try {
      const pending = await this.prisma.notificationOutbox.findMany({
        where: { availableAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const item of pending) {
        try {
          await this.createNotification({
            userId: item.userId, type: item.type, title: item.title,
            message: item.message, amount: item.amount ?? undefined,
            entityType: item.entityType, entityId: item.entityId,
            dedupKey: item.dedupKey,
          });
          await this.prisma.notificationOutbox.delete({ where: { id: item.id } });
        } catch (err) {
          if (isUniqueViolation(err)) {
            await this.prisma.notificationOutbox.delete({ where: { id: item.id } });
            continue;
          }
          await this.prisma.notificationOutbox.update({
            where: { id: item.id },
            data: {
              attempts: { increment: 1 },
              availableAt: new Date(Date.now() + Math.min(3_600_000, 2 ** Math.min(item.attempts, 10) * 1_000)),
              lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
            },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Processamento da outbox falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listForUser(userId: string, query: ListNotificationsQuery) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    return {
      items: items.map(toResponse),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async unreadCount(userId: string) {
    const unread = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unread };
  }

  async markAsRead(userId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });

    if (result.count !== 1) {
      throw new NotFoundException('Notificação não encontrada.');
    }

    return { message: 'Notificação marcada como lida.' };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return {
      message: 'Todas as notificações foram marcadas como lidas.',
      updated: result.count,
    };
  }
}

function stableDedupKey(data: CreateNotificationData): string {
  if (data.entityType && data.entityId) return `${data.type}:${data.entityType}:${data.entityId}`;
  return `${data.type}:${data.title}:${data.message ?? ''}`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function toResponse(n: Notification): {
  id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  amount: number | null;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
} {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    amount: n.amount == null ? null : Number(n.amount),
    entityType: n.entityType,
    entityId: n.entityId,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
