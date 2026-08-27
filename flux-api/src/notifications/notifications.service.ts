import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
  async safeCreate(data: CreateNotificationData): Promise<void> {
    try {
      await this.createNotification(data);
    } catch (err) {
      this.logger.error(
        `Falha ao criar notificação (${data.type}) para user ${data.userId}: ${data.title}`,
        err instanceof Error ? err.stack : String(err),
      );
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