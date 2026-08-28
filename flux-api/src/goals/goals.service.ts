import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GoalStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.module';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { AlertsService } from '../alerts/alerts.service';

const GOAL_MAX_TARGET = new Prisma.Decimal('100000000.00');

type GoalWithContributions = Prisma.GoalGetPayload<{
  include: { contributions: true };
}>;

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService, private readonly alerts?: AlertsService) {}

  private static toMoney(n: number): Prisma.Decimal {
    return new Prisma.Decimal(n.toFixed(2));
  }

  // ============================================================
  // Listagem — metas do usuário autenticado com campos calculados
  // ============================================================
  async list(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId, deletedAt: null },
      include: { contributions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });

    return { items: goals.map((g) => this.toResponse(g)) };
  }

  async create(userId: string, dto: CreateGoalDto) {
    const target = GoalsService.toMoney(dto.targetAmount);
    if (target.gt(GOAL_MAX_TARGET)) {
      throw new BadRequestException('Valor objetivo acima do limite permitido.');
    }
    const deadline = this.resolveDeadline(dto.deadline);

    const goal = await this.prisma.goal.create({
      data: {
        userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        targetAmount: target,
        deadline,
      },
      include: { contributions: true },
    });

    return {
      message: 'Meta criada com sucesso.',
      goal: this.toResponse(goal),
    };
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    const goal = await this.findOwned(userId, id);

    if (goal.status === 'COMPLETED') {
      throw new ConflictException(
        'Meta concluída não pode ser editada. Crie uma nova meta.',
      );
    }

    const data: Prisma.GoalUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.targetAmount !== undefined) {
      const target = GoalsService.toMoney(dto.targetAmount);
      if (target.lt(goal.currentAmount)) {
        throw new BadRequestException(
          'Novo valor objetivo não pode ser menor que o valor já reservado.',
        );
      }
      data.targetAmount = target;
    }
    if (dto.deadline !== undefined) {
      data.deadline = dto.deadline === null ? null : this.resolveDeadline(dto.deadline);
    }
    if (dto.status !== undefined) {
      // transições permitidas apenas entre ACTIVE e PAUSED.
      // COMPLETED é alcançado somente por aporte que atinge o objetivo.
      data.status = dto.status;
    }

    const updated = await this.prisma.goal.update({
      where: { id: goal.id },
      data,
      include: { contributions: true },
    });

    return { message: 'Meta atualizada.', goal: this.toResponse(updated) };
  }

  /**
    * Metas concluídas são ocultadas por soft-delete, preservando saldo,
    * ledger e histórico da meta. Metas não concluídas só saem sem reserva.
   */
  async remove(userId: string, id: string) {
    const goal = await this.findOwned(userId, id);
    if (goal.status === 'COMPLETED') {
      const hidden = await this.prisma.goal.updateMany({
        where: { id: goal.id, userId, status: 'COMPLETED', deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (hidden.count !== 1) throw new ConflictException('Meta não pôde ser excluída.');
      return { message: 'Meta excluída.' };
    }
    const deleted = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.goal.updateMany({
        where: { id: goal.id, userId, currentAmount: 0, deletedAt: null },
        data: { updatedAt: new Date() },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          'Esta meta ainda tem valor reservado. Retire o dinheiro antes de excluir.',
        );
      }
      return tx.goal.delete({ where: { id: goal.id } });
    });
    void deleted;
    return { message: 'Meta excluída.' };
  }

  /**
   * Depósito: debita o saldo da conta com compare-and-set dentro de
   * transação (impossível saldo negativo), credita a meta, registra a
   * contribuição e cria as transações de ledger (GOAL_DEPOSIT/OUT).
   */
  async deposit(userId: string, id: string, amountNumber: number, idempotencyKey?: string) {
    const amount = GoalsService.toMoney(amountNumber);
    const goal = await this.findOwned(userId, id);

    if (goal.status === 'PAUSED') {
      throw new ConflictException('Meta pausada. Retome-a para adicionar dinheiro.');
    }
    if (goal.status === 'COMPLETED') {
      throw new ConflictException('Meta já concluída.');
    }

    const account = await this.prisma.account.findUnique({ where: { userId } });
    if (!account) throw new NotFoundException('Conta não encontrada.');
    if (account.status !== 'ACTIVE') {
      throw new BadRequestException('Sua conta está bloqueada.');
    }

    const operationHash = hashOperation({ goalId: id, type: 'DEPOSIT', amount: amount.toString() });
    if (idempotencyKey) {
      const previous = await this.prisma.transaction.findFirst({ where: { accountId: account.id, idempotencyKey } });
      if (previous) return this.replayMovement(previous, operationHash, id, 'Aporte');
    }

    let movement: { before: number; after: number };
    try { movement = await this.prisma.$transaction(
      async (tx) => {
        const accountBefore = await tx.account.findUnique({ where: { id: account.id }, select: { balance: true } });
        const debit = await tx.account.updateMany({
          where: {
            id: account.id,
            status: 'ACTIVE',
            balance: { gte: amount },
          },
          data: { balance: { decrement: amount } },
        });
        if (debit.count !== 1) {
          throw new BadRequestException('Saldo insuficiente para este aporte.');
        }

        const updated = await tx.goal.updateMany({
          where: {
            id: goal.id,
            userId,
            status: 'ACTIVE',
            currentAmount: { lte: goal.targetAmount.sub(amount) },
          },
          data: { currentAmount: { increment: amount } },
        });
        if (updated.count !== 1) {
          throw new ConflictException('Meta não pôde ser atualizada.');
        }

        await tx.transaction.create({
          data: {
            accountId: account.id,
            type: 'GOAL_DEPOSIT',
            direction: 'OUT',
            status: 'COMPLETED',
            amount,
            description: `Meta: ${goal.name}`,
            idempotencyKey,
            idempotencyHash: operationHash,
            goalId: goal.id,
          },
        });

        await tx.goalContribution.create({
          data: { goalId: goal.id, type: 'DEPOSIT', amount },
        });
        return { before: Number(accountBefore?.balance ?? 0), after: Number(accountBefore?.balance ?? 0) - Number(amount) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    ); } catch (err) {
      if (idempotencyKey && isUniqueViolation(err)) {
        const previous = await this.prisma.transaction.findFirst({ where: { accountId: account.id, idempotencyKey } });
        if (previous) return this.replayMovement(previous, operationHash, id, 'Aporte');
      }
      throw err;
    }

    if (this.alerts) await this.alerts.onBalanceChanged({ userId, before: movement!.before, after: movement!.after, entityType: 'goal', entityId: goal.id });

    // Conclusão automática quando o aporte atinge o objetivo
    let fresh = await this.loadGoal(goal.id);
    let completed = false;
    if (
      fresh &&
      fresh.status === 'ACTIVE' &&
      fresh.currentAmount.gte(fresh.targetAmount)
    ) {
      fresh = await this.prisma.goal.update({
        where: { id: fresh.id },
        data: { status: 'COMPLETED' },
        include: { contributions: true },
      });
      completed = true;
    }

    return {
      message: completed
        ? 'Aporte realizado. Meta concluída! 🎉'
        : 'Aporte realizado.',
      completed,
      goal: fresh ? this.toResponse(fresh) : null,
      balance: await this.currentBalance(userId),
    };
  }

  /**
   * Retirada: devolve o dinheiro à conta e reduz a reserva da meta.
   * Permitida em metas ACTIVE e PAUSED (o dinheiro é do usuário).
   * Se a meta estava COMPLETED e cair abaixo do objetivo, volta a ACTIVE.
   */
  async withdraw(userId: string, id: string, amountNumber: number, idempotencyKey?: string) {
    const amount = GoalsService.toMoney(amountNumber);
    const goal = await this.findOwned(userId, id);

    if (amount.gt(goal.currentAmount)) {
      throw new BadRequestException(
        'Valor maior que o disponível reservado nesta meta.',
      );
    }

    const account = await this.prisma.account.findUnique({ where: { userId } });
    if (!account) throw new NotFoundException('Conta não encontrada.');

    const operationHash = hashOperation({ goalId: id, type: 'WITHDRAW', amount: amount.toString() });
    if (idempotencyKey) {
      const previous = await this.prisma.transaction.findFirst({ where: { accountId: account.id, idempotencyKey } });
      if (previous) return this.replayMovement(previous, operationHash, id, 'Retirada');
    }

    let movement: { before: number; after: number };
    try { movement = await this.prisma.$transaction(
      async (tx) => {
        const accountBefore = await tx.account.findUnique({ where: { id: account.id }, select: { balance: true } });
        const reduced = await tx.goal.updateMany({
          where: { id: goal.id, userId, currentAmount: { gte: amount } },
          data: { currentAmount: { decrement: amount } },
        });
        if (reduced.count !== 1) {
          throw new BadRequestException(
            'Valor maior que o disponível reservado nesta meta.',
          );
        }

        const credit = await tx.account.updateMany({
          where: { id: account.id },
          data: { balance: { increment: amount } },
        });
        if (credit.count !== 1) {
          throw new BadRequestException('Conta não pôde ser creditada.');
        }

        await tx.transaction.create({
          data: {
            accountId: account.id,
            type: 'GOAL_WITHDRAW',
            direction: 'IN',
            status: 'COMPLETED',
            amount,
            description: `Meta: ${goal.name}`,
            idempotencyKey,
            idempotencyHash: operationHash,
            goalId: goal.id,
          },
        });

        await tx.goalContribution.create({
          data: { goalId: goal.id, type: 'WITHDRAW', amount },
        });
        return { before: Number(accountBefore?.balance ?? 0), after: Number(accountBefore?.balance ?? 0) + Number(amount) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    ); } catch (err) {
      if (idempotencyKey && isUniqueViolation(err)) {
        const previous = await this.prisma.transaction.findFirst({ where: { accountId: account.id, idempotencyKey } });
        if (previous) return this.replayMovement(previous, operationHash, id, 'Retirada');
      }
      throw err;
    }

    if (this.alerts) await this.alerts.onBalanceChanged({ userId, before: movement!.before, after: movement!.after, entityType: 'goal', entityId: goal.id });

    let fresh = await this.loadGoal(goal.id);
    if (
      fresh &&
      fresh.status === 'COMPLETED' &&
      fresh.currentAmount.lt(fresh.targetAmount)
    ) {
      fresh = await this.prisma.goal.update({
        where: { id: fresh.id },
        data: { status: 'ACTIVE' },
        include: { contributions: true },
      });
    }

    return {
      message: 'Retirada realizada.',
      goal: fresh ? this.toResponse(fresh) : null,
      balance: await this.currentBalance(userId),
    };
  }

  // ============================================================
  // Helpers
  // ============================================================
  private async findOwned(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId, deletedAt: null } });
    if (!goal) throw new NotFoundException('Meta não encontrada.');
    return goal;
  }

  private loadGoal(id: string) {
    return this.prisma.goal.findUnique({
      where: { id },
      include: { contributions: true },
    });
  }

  private async currentBalance(userId: string): Promise<number | null> {
    const acc = await this.prisma.account.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return acc ? Number(acc.balance) : null;
  }

  private async replayMovement(previous: { idempotencyHash: string | null }, operationHash: string, goalId: string, label: string) {
    if (previous.idempotencyHash !== operationHash) {
      throw new ConflictException('A chave de idempotência já foi usada com outra movimentação.');
    }
    const goal = await this.loadGoal(goalId);
    return { message: `${label} realizado.`, goal: goal ? this.toResponse(goal) : null, balance: await this.currentBalance(goal?.userId ?? '') };
  }

  private resolveDeadline(raw?: string | null): Date | null {
    if (raw == null) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) throw new BadRequestException('Data alvo inválida.');
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (d.getTime() < startOfToday.getTime()) {
      throw new BadRequestException('Data alvo deve ser hoje ou no futuro.');
    }
    return d;
  }

  private toResponse(goal: GoalWithContributions) {
    const target = Number(goal.targetAmount);
    const current = Number(goal.currentAmount);
    const remaining = Math.max(0, +(target - current).toFixed(2));
    const percent =
      target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : 0;

    const forecast = computeForecast(goal);

    return {
      id: goal.id,
      name: goal.name,
      description: goal.description,
      status: goal.status,
      deadline: goal.deadline,
      createdAt: goal.createdAt,
      targetAmount: target,
      currentAmount: current,
      remaining,
      percent,
      completedAt:
        goal.status === 'COMPLETED'
          ? lastDepositDate(goal.contributions)
          : null,
      forecastMonths: forecast.months,
      forecastDate: forecast.date,
      onTrack: onTrack(goal.deadline, forecast.date),
    };
  }
}

function hashOperation(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

// ============================================================
// Previsão de conclusão — baseada SOMENTE em aportes reais:
// ritmo mensal = líquido aportado / meses decorridos desde o
// primeiro DEPOSIT (mínimo de meio mês para evitar explosões).
// Sem aportes ou ritmo <= 0 -> sem previsão.
// ============================================================
export function computeForecast(goal: {
  currentAmount: Prisma.Decimal;
  targetAmount: Prisma.Decimal;
  status: GoalStatus;
  contributions: { type: string; amount: Prisma.Decimal; createdAt: Date }[];
}): { months: number | null; date: Date | null } {
  if (goal.status === 'COMPLETED') return { months: null, date: null };

  const deposits = goal.contributions.filter((c) => c.type === 'DEPOSIT');
  if (deposits.length === 0) return { months: null, date: null };

  const first = deposits[0].createdAt;
  const days = Math.max(
    1,
    (Date.now() - first.getTime()) / (1000 * 60 * 60 * 24),
  );
  const monthsElapsed = Math.max(days / 30.44, 0.5);

  let net = new Prisma.Decimal(0);
  for (const c of goal.contributions) {
    net = c.type === 'DEPOSIT' ? net.add(c.amount) : net.sub(c.amount);
  }
  const monthlyRate = Number(net) / monthsElapsed;
  if (monthlyRate <= 0) return { months: null, date: null };

  const remainingNum = Math.max(
    0,
    Number(new Prisma.Decimal(goal.targetAmount).sub(goal.currentAmount)),
  );
  if (remainingNum <= 0) return { months: null, date: null };

  const months = Math.ceil(remainingNum / monthlyRate);
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return { months, date };
}

function lastDepositDate(
  contributions: { type: string; createdAt: Date }[],
): Date | null {
  let latest: Date | null = null;
  for (const c of contributions) {
    if (c.type !== 'DEPOSIT') continue;
    if (!latest || c.createdAt > latest) latest = c.createdAt;
  }
  return latest;
}

function onTrack(deadline: Date | null, forecastDate: Date | null): boolean | null {
  if (!deadline || !forecastDate) return null;
  return forecastDate.getTime() <= deadline.getTime();
}
