import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LoanInstallmentStatus, LoanStatus, Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../alerts/alerts.service';
import { PrismaService } from '../prisma/prisma.module';
import { CreateLoanDto } from './dto/create-loan.dto';
import { LoanResponse } from './dto/loan-response.dto';
import { SimulateLoanDto } from './dto/simulate-loan.dto';

/**
 * Taxa mensal oficial de referência da Flux (única fonte, definida SÓ aqui).
 * Utilizada na simulação e na solicitação — o frontend nunca informa a taxa.
 */
export const LOAN_MONTHLY_RATE = new Prisma.Decimal('0.0199');

/** Estados que impedem reenviar a mesma solicitação (ainda ativa). */
const NON_TERMINAL_STATUSES: LoanStatus[] = [
  LoanStatus.REQUESTED,
  LoanStatus.UNDER_REVIEW,
  LoanStatus.APPROVED,
];

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly alerts?: AlertsService,
  ) {}

  /**
   * Central do cálculo (Tabela Price). Usada pela simulação pública e pela
   * solicitação autenticada — os valores são SEMPRE recalculados no servidor.
   */
  private calcLoanValues(amount: number, installments: number) {
    const rate = LOAN_MONTHLY_RATE;
    const principal = new Prisma.Decimal(amount.toFixed(2));
    const n = installments;

    // Tabela Price: parcela = P · [i·(1+i)^n] / [(1+i)^n − 1]
    const onePlus = rate.add(1);
    const factor = onePlus.pow(n);
    const installment = principal.mul(rate.mul(factor)).div(factor.sub(1));
    const installmentValue = installment.toDecimalPlaces(2);

    const totalAmount = installmentValue.mul(n);
    const interestTotal = totalAmount.sub(principal);

    return {
      rate,
      principal,
      installmentValue,
      totalAmount,
      interestTotal,
    };
  }

  simulate(dto: SimulateLoanDto) {
    const { rate, principal, installmentValue, totalAmount, interestTotal } =
      this.calcLoanValues(dto.amount, dto.installments);

    return {
      amount: principal.toNumber(),
      interestRate: rate.toNumber(),
      installments: dto.installments,
      installmentValue: installmentValue.toNumber(),
      totalAmount: totalAmount.toNumber(),
      interestTotal: interestTotal.toNumber(),
    };
  }

  /**
   * Solicitação de empréstimo (autenticada).
   *
   * Análise V1 (abordagem mais simples, documentada): aprovamos imediatamente
   * toda solicitação válida. O registro é criado como `REQUESTED` e transiciona
   * na sequência para `APPROVED` (com `approvedAt`), sem etapa manual de análise.
   * Empréstimos `APPROVED` são os que a Fase 3 (contratação) poderá contratar.
   *
   * Nesta fase NÃO há liberação de crédito, NÃO há transação, NÃO há parcelas
   * e NÃO há alteração de saldo.
   */
  async request(userId: string, dto: CreateLoanDto) {
    const account = await this.prisma.account.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException('Conta não encontrada para o usuário.');
    }

    // Isolamento: a checagem de reenvio parte do accountId do próprio usuário.
    const existing = await this.prisma.loan.findFirst({
      where: {
        accountId: account.id,
        status: { in: NON_TERMINAL_STATUSES },
        amount: dto.amount,
        installments: dto.installments,
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'Você já possui uma solicitação em andamento com esses valores.',
      );
    }

    // Recalcula tudo no servidor; nada vindo do frontend é confiável.
    const { rate, principal, installmentValue, totalAmount, interestTotal } =
      this.calcLoanValues(dto.amount, dto.installments);

    const loan = await this.prisma.loan.create({
      data: {
        userId,
        accountId: account.id,
        status: LoanStatus.REQUESTED,
        amount: principal,
        interestRate: rate,
        installments: dto.installments,
        installmentValue,
        totalAmount,
        interestTotal,
      },
    });

    // Análise V1: aprovação automática imediata.
    const approved = await this.prisma.loan.update({
      where: { id: loan.id },
      data: { status: LoanStatus.APPROVED, approvedAt: new Date() },
    });

    // Notificação criada SOMENTE após a aprovação, pós-commit, via safeCreate:
    // falha aqui é logada e NUNCA reverte/interrompe a aprovação do empréstimo.
    await this.notifications.safeCreate({
      userId,
      type: 'LOAN_APPROVED',
      title: `Empréstimo de ${formatBRL(approved.amount)} pré-aprovado`,
      message: `${approved.installments}x de ${formatBRL(approved.installmentValue)} · taxa de ${formatPercent(approved.interestRate)} a.m.`,
      amount: Number(approved.amount),
      entityType: 'loan',
      entityId: approved.id,
    });

    return toLoanResponse(approved);
  }

  async listForUser(userId: string) {
    const loans = await this.prisma.loan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    // Lote 1 · lembrete lazy de parcela a vencer (best-effort, respeita preferências)
    if (this.alerts) await this.alerts.checkInstallmentDue(userId);
    return loans.map(toLoanResponse);
  }

  async detailForUser(userId: string, id: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { id, userId },
    });
    if (!loan) {
      throw new NotFoundException('Empréstimo não encontrado.');
    }
    const installments = await this.prisma.loanInstallment.findMany({
      where: { loanId: loan.id },
      orderBy: { number: 'asc' },
    });
    return {
      ...toLoanResponse(loan),
      installments: installments.map(toInstallmentResponse),
    };
  }

  /**
   * CONTRATAÇÃO do empréstimo (autenticado, somente usuário dono).
   *
   * Tudo acontece em UMA transação ReadCommitted: CAS de status (APPROVED →
   * CONTRACTED), crédito do valor na conta, transação IN type LOAN e geração
   * de TODAS as parcelas. Qualquer falha reverte tudo.
   *
   * Nenhum valor vem do frontend: taxa, valores e datas são recalculados aqui.
   */
  async contract(userId: string, loanId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, userId },
    });
    if (!loan) {
      throw new NotFoundException('Empréstimo não encontrado.');
    }
    if (loan.status !== LoanStatus.APPROVED) {
      throw new ConflictException('Empréstimo não está disponível para contratação.');
    }

    const contractDate = new Date();

    const created = await this.prisma.$transaction(
      async (tx) => {
        // CAS: só quem estava APPROVED passa a CONTRACTED. Contratação dupla
        // ou concorrente cai aqui (count !== 1) sem crédito.
        const cas = await tx.loan.updateMany({
          where: { id: loan.id, status: LoanStatus.APPROVED },
          data: {
            status: LoanStatus.CONTRACTED,
            contractedAt: contractDate,
          },
        });
        if (cas.count !== 1) {
          throw new ConflictException('Empréstimo não está disponível para contratação.');
        }

        const account = await tx.account.findUnique({
          where: { userId },
          select: { id: true, status: true, balance: true },
        });
        if (!account) {
          throw new NotFoundException('Conta não encontrada.');
        }
        if (account.status !== 'ACTIVE') {
          throw new UnprocessableEntityException('Sua conta está bloqueada.');
        }

        // Crédito do valor principal (sem guarda de limite — é crédito).
        await tx.account.update({
          where: { id: account.id },
          data: { balance: { increment: loan.amount } },
        });

        const disbursementTx = await tx.transaction.create({
          data: {
            accountId: account.id,
            type: 'LOAN',
            direction: 'IN',
            status: 'COMPLETED',
            amount: loan.amount,
            description: 'Empréstimo contratado',
            counterpartyName: 'Flux Empréstimos',
            counterpartyNumber: null,
          },
        });

        // Geração das parcelas Price — mesma fonte de cálculo do empréstimo.
        const installments = buildInstallments(
          loan,
          LOAN_MONTHLY_RATE,
          contractDate,
        );
        await tx.loanInstallment.createMany({
          data: installments,
        });

        return {
          disbursementTx,
          installments,
          balanceBefore: Number(account.balance),
          balanceAfter: Number(account.balance) + Number(loan.amount),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    // Pós-commit: leitura das parcelas (IDs gerados) e notificação.
    const installments = await this.prisma.loanInstallment.findMany({
      where: { loanId: loan.id },
      orderBy: { number: 'asc' },
    });

    // Notificação após o commit — falha é capturada pelo safeCreate e NUNCA
    // reverte a contratação já efetivada.
    await this.notifications.safeCreate({
      userId,
      type: 'LOAN_DISBURSED',
      title: `Empréstimo de ${formatBRL(loan.amount)} liberado na sua conta`,
      message: `${loan.installments}x de ${formatBRL(loan.installmentValue)} · primeira parcela em ${formatDate(installments[0]?.dueDate)}`,
      amount: Number(loan.amount),
      entityType: 'loan',
      entityId: loan.id,
    });

    if (this.alerts) await this.alerts.onBalanceChanged({
      userId, before: created.balanceBefore, after: created.balanceAfter,
      entityType: 'loan', entityId: loan.id,
    });

    // Lote 1 · Alerta configurável de empréstimo contratado
    if (this.alerts) {
      await this.alerts.onLoanContracted({
        userId,
        loanId: loan.id,
        installments: loan.installments,
        installmentValue: Number(loan.installmentValue),
      });
    }

    return {
      loan: toLoanResponse({
        ...loan,
        status: LoanStatus.CONTRACTED,
        contractedAt: contractDate,
      }),
      installments: installments.map(toInstallmentResponse),
      disbursement: {
        id: created.disbursementTx.id,
        type: created.disbursementTx.type,
        direction: created.disbursementTx.direction,
        status: created.disbursementTx.status,
        amount: Number(created.disbursementTx.amount),
        description: created.disbursementTx.description,
        counterpartyName: created.disbursementTx.counterpartyName,
        createdAt: created.disbursementTx.createdAt,
      },
    };
  }

  /**
   * PAGAMENTO DE PARCELA (autenticado, isolado por userId).
   *
   * V1: pagamento somente integral; o valor SEMPRE vem do banco (não há body).
   * Aceita parcelas PENDING e OVERDUE; atraso é lazy (dueDate < now). Pagamento
   * fora de ordem é permitido. Quando nenhuma parcela restar, o loan vira
   * PAID_OFF. Tudo em UMA transação ReadCommitted: debit-guard do saldo +
   * CAS da parcela → pagamento duplicado/concorrente é impossível.
   */
  async pay(userId: string, loanId: string, installmentId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, userId },
    });

    if (!loan) {
      throw new NotFoundException('Empréstimo não encontrado.');
    }
    if (loan.status !== LoanStatus.CONTRACTED) {
      throw new ConflictException('Empréstimo não está ativo para pagamento.');
    }

    const installment = await this.prisma.loanInstallment.findFirst({
      where: { id: installmentId, loanId },
      select: { id: true, number: true, amount: true, status: true, dueDate: true },
    });
    if (!installment) {
      throw new NotFoundException('Parcela não encontrada para este empréstimo.');
    }
    if (installment.status === LoanInstallmentStatus.PAID) {
      throw new ConflictException('Parcela já foi paga.');
    }

    const amount = installment.amount;
    const payDate = new Date();

    const { paidOff, balanceBefore, balanceAfter } = await this.prisma.$transaction(
      async (tx) => {
        const account = await tx.account.findUnique({
          where: { userId },
          select: { id: true, status: true, balance: true },
        });
        if (!account) {
          throw new NotFoundException('Conta não encontrada.');
        }
        if (account.status !== 'ACTIVE') {
          throw new UnprocessableEntityException('Sua conta está bloqueada.');
        }

        // 1) Debit-guard: só debita se saldo cobre e conta ativa.
        const debit = await tx.account.updateMany({
          where: {
            id: account.id,
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

        // 2) CAS da parcela: PENDING/OVERDUE → PAID. Concorrência/replay cai aqui.
        const cas = await tx.loanInstallment.updateMany({
          where: {
            id: installment.id,
            loanId,
            status: { in: [LoanInstallmentStatus.PENDING, LoanInstallmentStatus.OVERDUE] },
          },
          data: {
            status: LoanInstallmentStatus.PAID,
            paidAt: payDate,
            paidAmount: amount,
          },
        });
        if (cas.count !== 1) {
          throw new ConflictException('Parcela já foi paga.');
        }

        // 3) Transação debitando a conta.
        await tx.transaction.create({
          data: {
            accountId: account.id,
            type: 'LOAN_PAYMENT',
            direction: 'OUT',
            status: 'COMPLETED',
            amount,
            description: `Pagamento da parcela ${installment.number} de ${formatBRL(amount)} (empréstimo)`,
            counterpartyName: 'Flux Empréstimos',
            counterpartyNumber: null,
          },
        });

        // 4) Se nenhuma parcela restar, quita o loan (CONTRACTED → PAID_OFF).
        const remaining = await tx.loanInstallment.count({
          where: { loanId, status: { in: [LoanInstallmentStatus.PENDING, LoanInstallmentStatus.OVERDUE] } },
        });
        let paidOff = false;
        if (remaining === 0) {
          const quit = await tx.loan.updateMany({
            where: { id: loanId, status: LoanStatus.CONTRACTED },
            data: { status: LoanStatus.PAID_OFF },
          });
          paidOff = quit.count === 1;
        }

        return { paidOff, balanceBefore: Number(account.balance), balanceAfter: Number(account.balance) - Number(amount) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    // Pós-commit: leituras para a resposta e notificações (safeCreate).
    const [paid, loanFinal, remaining] = await Promise.all([
      this.prisma.loanInstallment.findFirst({
        where: { id: installment.id, loanId },
      }),
      this.prisma.loan.findUnique({ where: { id: loanId } }),
      this.prisma.loanInstallment.count({
        where: { loanId, status: { in: [LoanInstallmentStatus.PENDING, LoanInstallmentStatus.OVERDUE] } },
      }),
    ]);

    // Notificações somente depois do commit — falha é engolida, nunca reverte.
    await this.notifications.safeCreate({
      userId,
      type: 'LOAN_INSTALLMENT_PAID',
      title: `Parcela ${installment.number} de ${formatBRL(amount)} paga`,
      message: `Vencimento ${formatDate(installment.dueDate)} · restam ${remaining} parcela(s)`,
      amount: Number(amount),
      entityType: 'loan_installment',
      entityId: installment.id,
    });

    if (paidOff) {
      await this.notifications.safeCreate({
        userId,
        type: 'LOAN_PAID_OFF',
        title: 'Empréstimo quitado',
        message: `Todas as ${loan.installments} parcelas foram pagas.`,
        ...(loanFinal?.totalAmount != null
          ? { amount: Number(loanFinal.totalAmount) }
          : {}),
        entityType: 'loan',
        entityId: loanId,
      });
    }

    if (this.alerts) await this.alerts.onBalanceChanged({
      userId, before: balanceBefore, after: balanceAfter,
      entityType: 'loan_installment', entityId: installment.id,
    });

    // Lote 1 · lembrete lazy da próxima parcela (respeita preferências)
    if (this.alerts) await this.alerts.checkInstallmentDue(userId);

    return {
      installment: paid ? toInstallmentResponse(paid) : null,
      loan: loanFinal ? toLoanResponse(loanFinal) : null,
      remaining,
      paidOff,
    };
  }
}

/** Converte Decimal/Date em JSON limpo (números e timestamps UTC). */
function toLoanResponse(loan: {
  id: string;
  userId: string;
  accountId: string;
  status: LoanStatus;
  amount: Prisma.Decimal;
  interestRate: Prisma.Decimal;
  installments: number;
  installmentValue: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  interestTotal: Prisma.Decimal;
  requestedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  contractedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): LoanResponse {
  return {
    id: loan.id,
    userId: loan.userId,
    accountId: loan.accountId,
    status: loan.status,
    amount: loan.amount.toNumber(),
    interestRate: loan.interestRate.toNumber(),
    installments: loan.installments,
    installmentValue: loan.installmentValue.toNumber(),
    totalAmount: loan.totalAmount.toNumber(),
    interestTotal: loan.interestTotal.toNumber(),
    requestedAt: loan.requestedAt.toISOString(),
    approvedAt: loan.approvedAt?.toISOString() ?? null,
    rejectedAt: loan.rejectedAt?.toISOString() ?? null,
    contractedAt: loan.contractedAt?.toISOString() ?? null,
    createdAt: loan.createdAt.toISOString(),
    updatedAt: loan.updatedAt.toISOString(),
  };
}

function formatBRL(value: Prisma.Decimal | number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value));
}

/**
 * Gera as parcelas Price da contratação.
 *
 * - `amount` sempre = installmentValue, exceto na última, que absorve o
 *   arredondamento residuo (amount = principal + interest) para zerar o saldo;
 * - `principal` + `interest` = `amount`;
 * - primeira parcela em +1 mês e vencimentos mensais (UTC, mesmo dia do mês).
 */
function buildInstallments(
  loan: { id: string; amount: Prisma.Decimal; installmentValue: Prisma.Decimal; installments: number },
  rate: Prisma.Decimal,
  contractDate: Date,
): Array<{
  loanId: string;
  number: number;
  dueDate: Date;
  amount: Prisma.Decimal;
  principal: Prisma.Decimal;
  interest: Prisma.Decimal;
  status: LoanInstallmentStatus;
}> {
  const { id: loanId, amount: principalTotal, installmentValue, installments: n } = loan;
  const rows: Array<{
    loanId: string;
    number: number;
    dueDate: Date;
    amount: Prisma.Decimal;
    principal: Prisma.Decimal;
    interest: Prisma.Decimal;
    status: LoanInstallmentStatus;
  }> = [];

  let remaining = principalTotal;

  for (let i = 1; i <= n; i++) {
    const interest = remaining.mul(rate).toDecimalPlaces(2);

    let principal: Prisma.Decimal;
    let amount: Prisma.Decimal;

    if (i === n) {
      // Última parcela: principal = saldo devedor exato → zera o saldo.
      principal = remaining;
      amount = principal.add(interest);
    } else {
      principal = installmentValue.sub(interest).toDecimalPlaces(2);
      amount = installmentValue;
    }

    rows.push({
      loanId,
      number: i,
      dueDate: installmentDueDate(contractDate, i),
      amount,
      principal,
      interest,
      status: LoanInstallmentStatus.PENDING,
    });

    remaining = remaining.sub(principal);
  }

  return rows;
}

/** Vencimento mensal UTC: contratação + N meses, mesmo dia do mês. */
function installmentDueDate(contractDate: Date, offsetMonths: number): Date {
  return new Date(
    Date.UTC(
      contractDate.getUTCFullYear(),
      contractDate.getUTCMonth() + offsetMonths,
      contractDate.getUTCDate(),
    ),
  );
}

function toInstallmentResponse(i: {
  id: string;
  number: number;
  dueDate: Date;
  amount: Prisma.Decimal;
  principal: Prisma.Decimal;
  interest: Prisma.Decimal;
  status: LoanInstallmentStatus;
  paidAt: Date | null;
  paidAmount: Prisma.Decimal | null;
}) {
  return {
    id: i.id,
    number: i.number,
    dueDate: i.dueDate.toISOString(),
    amount: i.amount.toNumber(),
    principal: i.principal.toNumber(),
    interest: i.interest.toNumber(),
    status: i.status,
    paidAt: i.paidAt?.toISOString() ?? null,
    paidAmount: i.paidAmount == null ? null : i.paidAmount.toNumber(),
  };
}

function formatDate(date?: Date): string {
  if (!date) return '—';
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

function formatPercent(value: Prisma.Decimal | number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
