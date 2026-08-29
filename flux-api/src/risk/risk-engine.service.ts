import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskSignal = 'NEW_DEVICE' | 'NEW_RECIPIENT' | 'HIGH_VALUE' | 'UNUSUAL_HOUR' | 'DIFFERENT_NETWORK';

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
  operationHash: string;
}

const WEIGHTS: Record<RiskSignal, number> = {
  NEW_DEVICE: 30,
  NEW_RECIPIENT: 25,
  HIGH_VALUE: 25,
  UNUSUAL_HOUR: 10,
  DIFFERENT_NETWORK: 10,
};
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class RiskEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async assess(userId: string, input: {
    accountNumber: string;
    amount: number;
    description: string | null;
    sessionId: string | null;
    ip: string | null;
    now?: Date;
  }): Promise<RiskAssessment> {
    const operationHash = hashOperation({
      accountNumber: input.accountNumber,
      amount: new Prisma.Decimal(input.amount.toFixed(2)).toString(),
      description: input.description,
    });
    const session = input.sessionId
      ? await this.prisma.authSession.findFirst({ where: { id: input.sessionId, userId }, select: { deviceIdHash: true, ip: true } })
      : null;
    const previous = await this.prisma.authSession.findMany({
      where: { userId, ...(input.sessionId ? { id: { not: input.sessionId } } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { deviceIdHash: true, ip: true },
      take: 50,
    });
    const account = await this.prisma.account.findUnique({ where: { userId }, select: { id: true } });
    const history = account
      ? await this.prisma.transaction.findMany({
          where: { accountId: account.id, type: 'PIX', direction: 'OUT' },
          orderBy: { createdAt: 'desc' },
          select: { amount: true, counterpartyNumber: true },
          take: 100,
        })
      : [];

    const signals: RiskSignal[] = [];
    if (session?.deviceIdHash && !previous.some((row) => row.deviceIdHash === session.deviceIdHash)) {
      signals.push('NEW_DEVICE');
    }
    if (!history.some((row) => row.counterpartyNumber === input.accountNumber)) {
      signals.push('NEW_RECIPIENT');
    }
    if (history.length > 0) {
      const highest = Math.max(...history.map((row) => Number(row.amount)));
      if (input.amount >= Math.max(1000, highest * 2)) signals.push('HIGH_VALUE');
    }
    const hour = (input.now ?? new Date()).getHours();
    if (hour < 6 || hour >= 23) signals.push('UNUSUAL_HOUR');
    const previousNetwork = session?.deviceIdHash
      ? (previous.find((row) => row.deviceIdHash === session.deviceIdHash)?.ip ?? previous[0]?.ip)
      : previous[0]?.ip;
    if (ipPrefix(input.ip) && ipPrefix(previousNetwork ?? null) && ipPrefix(input.ip) !== ipPrefix(previousNetwork ?? null)) {
      signals.push('DIFFERENT_NETWORK');
    }

    const score = signals.reduce((total, signal) => total + WEIGHTS[signal], 0);
    return { score, level: levelFor(score), signals, operationHash };
  }

  decision(userId: string, assessment: RiskAssessment, confirmationToken?: string): 'EXECUTE' | 'CONFIRM' | 'BLOCK' {
    if (assessment.level === 'CRITICAL') return 'BLOCK';
    if (assessment.level === 'LOW') return 'EXECUTE';
    return confirmationToken && this.verifyConfirmation(confirmationToken, userId, assessment) ? 'EXECUTE' : 'CONFIRM';
  }

  confirmationToken(userId: string, assessment: RiskAssessment): string {
    const payload = Buffer.from(JSON.stringify({
      userId,
      operationHash: assessment.operationHash,
      score: assessment.score,
      level: assessment.level,
      expiresAt: Date.now() + CONFIRMATION_TTL_MS,
    })).toString('base64url');
    return `${payload}.${signature(payload, this.secret())}`;
  }

  publicAssessment(assessment: RiskAssessment) {
    return { score: assessment.score, level: assessment.level, signals: assessment.signals };
  }

  async notifyHighRisk(userId: string, assessment: RiskAssessment, title: string): Promise<void> {
    if (assessment.level !== 'HIGH' && assessment.level !== 'CRITICAL') return;
    await this.notifications.safeCreate({
      userId,
      type: 'ALERT_SECURITY',
      title,
      message: `Avaliação de segurança: risco ${assessment.level.toLowerCase()}.`,
      entityType: 'risk_assessment',
      entityId: assessment.operationHash,
      dedupKey: `risk:${assessment.level}:${assessment.operationHash}`,
    });
  }

  private verifyConfirmation(token: string, userId: string, assessment: RiskAssessment): boolean {
    try {
      const [payload, received] = token.split('.');
      if (!payload || !received) return false;
      const expected = signature(payload, this.secret());
      if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return false;
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        userId: string; operationHash: string; score: number; level: RiskLevel; expiresAt: number;
      };
      return value.userId === userId && value.operationHash === assessment.operationHash && value.score === assessment.score && value.level === assessment.level && value.expiresAt > Date.now();
    } catch {
      return false;
    }
  }

  private secret(): string {
    return this.config.get<string>('JWT_SECRET') ?? 'dev-secret';
  }
}

function levelFor(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

function hashOperation(value: unknown): string {
  return createHmac('sha256', 'flux-risk-operation').update(JSON.stringify(value)).digest('hex');
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const mapped = /^.*:ffff:(?<v4>\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)?.groups?.v4 ?? ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(mapped)) return mapped.split('.').slice(0, 2).join('.');
  return mapped.split(':').filter(Boolean).slice(0, 2).join(':');
}
