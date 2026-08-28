import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Card, Invoice, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { CardResponse } from './dto/card-response.dto';
import { CreateCardPurchaseDto } from './dto/create-card-purchase.dto';
import { CardPurchaseResponse } from './dto/card-purchase-response.dto';
import { InvoiceDetailResponse, InvoiceResponse } from './dto/invoice-response.dto';
import { PayInvoiceResponse } from './dto/pay-invoice-response.dto';
import { AlertsService } from '../alerts/alerts.service';
import { computeClosingDate, computeDueDate } from './invoice-date.util';

const CARD_CREDIT_LIMIT = new Prisma.Decimal('5000.00');
const CARD_EXPIRY_MONTHS = 60;

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly alerts?: AlertsService,
  ) {}

  async findOrCreateVirtual(userId: string): Promise<CardResponse> {
    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!account) {
      throw new NotFoundException('Conta não encontrada.');
    }

    const existing = await this.prisma.card.findFirst({
      where: { accountId: account.id },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return toResponse(existing);
    }

    const last4 = this.generateLast4();
    const created = await this.prisma.card.create({
      data: {
        accountId: account.id,
        userId,
        type: 'VIRTUAL',
        brand: 'FLUX',
        last4,
        number: this.generatePan(last4),
        status: 'ACTIVE',
        creditLimit: CARD_CREDIT_LIMIT,
        availableLimit: CARD_CREDIT_LIMIT,
        expiresAt: this.computeExpiry(),
      },
    });

    return toResponse(created);
  }

  async listForUser(userId: string): Promise<CardResponse[]> {
    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!account) {
      throw new NotFoundException('Conta não encontrada.');
    }

    const cards = await this.prisma.card.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
    });

    return cards.map(toResponse);
  }

  private generateLast4(): string {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('');
  }

  private generatePan(last4: string): string {
    let middle = '';
    while (middle.length < 8) {
      middle += String(Math.floor(Math.random() * 10));
    }
    return '4532' + middle + last4;
  }

  private computeExpiry(): Date {
    const now = new Date();
    return new Date(now.setMonth(now.getMonth() + CARD_EXPIRY_MONTHS));
  }

  async createPurchase(userId: string, dto: CreateCardPurchaseDto): Promise<CardPurchaseResponse> {
    const amount = new Prisma.Decimal(dto.amount.toFixed(2));
    if (amount.lte(0)) {
      throw new UnprocessableEntityException('Valor deve ser maior que zero.');
    }

    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!account) {
      throw new NotFoundException('Conta não encontrada.');
    }

    const card = dto.cardId
      ? await this.prisma.card.findFirst({
          where: { id: dto.cardId, accountId: account.id },
        })
      : await this.prisma.card.findFirst({
          where: { accountId: account.id },
          orderBy: { createdAt: 'asc' },
        });

    if (!card) {
      throw new NotFoundException('Cartão não encontrado.');
    }

    if (card.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Cartão bloqueado.');
    }

    if (amount.gt(card.availableLimit)) {
      throw new UnprocessableEntityException('Limite disponível insuficiente para esta compra.');
    }

    const description = dto.description?.trim() || 'Compra no cartão';
    const now = new Date();
    const closingDate = computeClosingDate(now);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const debit = await tx.card.updateMany({
          where: {
            id: card.id,
            status: 'ACTIVE',
            availableLimit: { gte: amount },
          },
          data: {
            availableLimit: { decrement: amount },
          },
        });

        if (debit.count !== 1) {
          throw new UnprocessableEntityException('Limite disponível insuficiente para esta compra.');
        }

        let invoice = await tx.invoice.findUnique({
          where: {
            cardId_closingDate: { cardId: card.id, closingDate },
          },
        });

        if (!invoice) {
          invoice = await tx.invoice.create({
            data: {
              cardId: card.id,
              closingDate,
              dueDate: computeDueDate(closingDate),
              status: 'OPEN',
              totalAmount: new Prisma.Decimal(0),
              paidAmount: new Prisma.Decimal(0),
            },
          });
        }

        const purchase = await tx.cardPurchase.create({
          data: {
            cardId: card.id,
            invoiceId: invoice.id,
            accountId: account.id,
            amount,
            description,
            status: 'COMPLETED',
          },
        });

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: { totalAmount: { increment: amount } },
        });

        return { purchase, invoice: updatedInvoice };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    // Notificação criada depois do commit — falha é capturada pelo safeCreate.
    await this.notifications.safeCreate({
      userId,
      type: 'CARD_PURCHASE',
      title: `Compra de ${formatBRL(amount)} aprovada no cartão ••${card.last4}`,
      message: description,
      amount: Number(amount),
      entityType: 'card_purchase',
      entityId: result.purchase.id,
    });

    return {
      id: result.purchase.id,
      amount: Number(result.purchase.amount),
      description: result.purchase.description,
      status: result.purchase.status,
      createdAt: result.purchase.createdAt,
      invoice: {
        id: result.invoice.id,
        closingDate: result.invoice.closingDate,
        dueDate: result.invoice.dueDate,
        totalAmount: Number(result.invoice.totalAmount),
        paidAmount: Number(result.invoice.paidAmount),
        status: result.invoice.status,
      },
      availableLimit: Number(card.availableLimit.sub(amount)),
    };
  }

  async block(userId: string): Promise<CardResponse> {
    const card = await this.getOwnedCard(userId);
    const updated = await this.prisma.card.update({
      where: { id: card.id },
      data: { status: 'BLOCKED' },
    });

    await this.notifications.safeCreate({
      userId,
      type: 'CARD_BLOCKED',
      title: 'Seu cartão foi bloqueado',
      message: `Cartão ••${updated.last4}`,
      entityType: 'card',
      entityId: updated.id,
    });

    return toResponse(updated);
  }

  async unblock(userId: string): Promise<CardResponse> {
    const card = await this.getOwnedCard(userId);
    const updated = await this.prisma.card.update({
      where: { id: card.id },
      data: { status: 'ACTIVE' },
    });

    await this.notifications.safeCreate({
      userId,
      type: 'CARD_UNBLOCKED',
      title: 'Seu cartão foi desbloqueado',
      message: `Cartão ••${updated.last4}`,
      entityType: 'card',
      entityId: updated.id,
    });

    return toResponse(updated);
  }

  async listInvoices(userId: string): Promise<InvoiceResponse[]> {
    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('Conta não encontrada.');
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { card: { accountId: account.id } },
      orderBy: { closingDate: 'desc' },
    });

    return invoices.map(toInvoiceResponse);
  }

  async getInvoiceDetail(userId: string, invoiceId: string): Promise<InvoiceDetailResponse> {
    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('Conta não encontrada.');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        card: { accountId: account.id },
      },
      include: {
        purchases: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada.');
    }

    return {
      id: invoice.id,
      closingDate: invoice.closingDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      paidAt: invoice.paidAt,
      purchases: invoice.purchases.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        description: p.description,
        status: p.status,
        createdAt: p.createdAt,
      })),
    };
  }

  async payInvoice(userId: string, invoiceId: string): Promise<PayInvoiceResponse> {
    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: { id: true, balance: true },
    });

    if (!account) {
      throw new NotFoundException('Conta não encontrada.');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        card: { accountId: account.id },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada.');
    }

    if (invoice.status === 'PAID') {
      throw new ConflictException('Esta fatura já foi paga.');
    }

    if (invoice.totalAmount.lte(0)) {
      throw new UnprocessableEntityException('Esta fatura não possui valor a pagar.');
    }

    const movement = await this.prisma.$transaction(
      async (tx) => {
        const accountBefore = await tx.account.findUnique({ where: { id: account.id }, select: { balance: true } });
        const debit = await tx.account.updateMany({
          where: {
            id: account.id,
            status: 'ACTIVE',
            balance: { gte: invoice.totalAmount },
          },
          data: {
            balance: { decrement: invoice.totalAmount },
          },
        });

        if (debit.count !== 1) {
          throw new UnprocessableEntityException('Saldo insuficiente para pagar a fatura.');
        }

        const markPaid = await tx.invoice.updateMany({
          where: {
            id: invoice.id,
            status: 'OPEN',
          },
          data: {
            status: 'PAID',
            paidAmount: invoice.totalAmount,
            paidAt: new Date(),
          },
        });

        if (markPaid.count !== 1) {
          throw new ConflictException('Esta fatura já foi paga.');
        }

        const card = await tx.card.findUnique({
          where: { id: invoice.cardId },
          select: { last4: true },
        });

        await tx.card.update({
          where: { id: invoice.cardId },
          data: { availableLimit: { increment: invoice.totalAmount } },
        });

        await tx.transaction.create({
          data: {
            accountId: account.id,
            type: 'CARD_PAYMENT',
            direction: 'OUT',
            status: 'COMPLETED',
            amount: invoice.totalAmount,
            description: `Pagamento de fatura (vencimento ${formatDate(invoice.dueDate)})`,
            counterpartyName: 'Flux Cartão',
            counterpartyNumber: card?.last4 ?? null,
          },
        });
        return { before: Number(accountBefore?.balance ?? 0), after: Number(accountBefore?.balance ?? 0) - Number(invoice.totalAmount) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const [paidInvoice, updatedCard] = await Promise.all([
      this.prisma.invoice.findUnique({ where: { id: invoice.id } }),
      this.prisma.card.findUnique({ where: { id: invoice.cardId } }),
    ]);

    // Notificação criada depois do commit — falha é capturada pelo safeCreate.
    await this.notifications.safeCreate({
      userId,
      type: 'INVOICE_PAID',
      title: `Fatura de ${formatBRL(invoice.totalAmount)} paga com sucesso`,
      message: `Paga em ${formatDate(new Date())} · Cartão ••${updatedCard?.last4 ?? '—'}`,
      amount: Number(invoice.totalAmount),
      entityType: 'invoice',
      entityId: invoice.id,
    });

    if (this.alerts) await this.alerts.onBalanceChanged({
      userId, before: movement.before, after: movement.after,
      entityType: 'invoice', entityId: invoice.id,
    });

    return {
      message: 'Fatura paga com sucesso.',
      invoice: toInvoiceResponse(paidInvoice!),
      availableLimit: Number(updatedCard!.availableLimit),
    };
  }

  private async getOwnedCard(userId: string) {
    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('Conta não encontrada.');
    }

    const card = await this.prisma.card.findFirst({
      where: { accountId: account.id },
      orderBy: { createdAt: 'asc' },
    });

    if (!card) {
      throw new NotFoundException('Cartão não encontrado.');
    }

    return card;
  }
}

function formatDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

function formatBRL(value: Prisma.Decimal | number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value));
}

function toResponse(card: Card): CardResponse {
  return {
    id: card.id,
    type: card.type,
    brand: card.brand,
    last4: card.last4,
    fullNumber: card.number,
    status: card.status,
    creditLimit: Number(card.creditLimit),
    availableLimit: Number(card.availableLimit),
    expiresAt: card.expiresAt,
    createdAt: card.createdAt,
  };
}

function toInvoiceResponse(invoice: Invoice): InvoiceResponse {
  return {
    id: invoice.id,
    closingDate: invoice.closingDate,
    dueDate: invoice.dueDate,
    status: invoice.status,
    totalAmount: Number(invoice.totalAmount),
    paidAmount: Number(invoice.paidAmount),
    paidAt: invoice.paidAt,
  };
}
