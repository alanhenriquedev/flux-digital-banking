import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionRevokedReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { ListLoginsQuery } from './dto/list-logins.query';
import {
  LoginContext,
  hashDeviceId,
  isValidDeviceId,
  maskIp,
  sanitizeIp,
  sanitizeUserAgent,
  summarizeUserAgent,
  summarizeUserAgentResponse,
} from './security.util';

const DEFAULT_SESSION_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TOUCH_CACHE = 10_000;

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  private readonly lastTouchAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async safeCreateLoginRecord(userId: string, context?: LoginContext): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.loginHistory.create({
          data: {
            userId,
            ip: sanitizeIp(context?.ip),
            userAgent: sanitizeUserAgent(context?.userAgent),
            deviceLabel: summarizeUserAgent(context?.userAgent),
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: { lastLoginAt: new Date() },
        });
      });
    } catch (err) {
      this.logger.error(
        `Falha ao registrar histórico de login para user ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async createSession(userId: string, context?: LoginContext, ttlMs?: number) {
    const ttl = ttlMs && ttlMs > 0 ? ttlMs : this.sessionTtlMs();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl);

    const session = await this.prisma.authSession.create({
      data: {
        userId,
        ip: sanitizeIp(context?.ip),
        userAgent: sanitizeUserAgent(context?.userAgent),
        deviceLabel: summarizeUserAgent(context?.userAgent),
        deviceIdHash: this.resolveDeviceIdHash(context?.deviceId),
        expiresAt,
        lastUsedAt: now,
      },
      select: { id: true, expiresAt: true, deviceIdHash: true },
    });

    this.lastTouchAt.set(session.id, now.getTime());
    if (this.lastTouchAt.size > MAX_TOUCH_CACHE) {
      this.pruneTouchCache();
    }

    return session;
  }

  /**
   * Converte o deviceId cru do cliente no hash que é efetivamente
   * persistido. Entradas inválidas/ausentes viram null (sessão sem
   * grupo — compatível com o comportamento anterior).
   */
  private resolveDeviceIdHash(raw: string | null | undefined): string | null {
    if (!isValidDeviceId(raw)) return null;
    return hashDeviceId(raw, this.deviceIdSecret());
  }

  private deviceIdSecret(): string {
    return (
      this.config.get<string>('DEVICE_ID_HASH_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      'dev-secret'
    );
  }

  findSession(sid: string) {
    return this.prisma.authSession.findUnique({ where: { id: sid } });
  }

  async touchSession(sid: string | null | undefined): Promise<void> {
    if (!sid) return;

    const now = Date.now();
    const interval = this.touchIntervalMs();
    const last = this.lastTouchAt.get(sid) ?? 0;
    if (now - last < interval) return;

    this.lastTouchAt.set(sid, now);
    if (this.lastTouchAt.size > MAX_TOUCH_CACHE) {
      this.pruneTouchCache();
    }

    try {
      await this.prisma.authSession.updateMany({
        where: { id: sid, lastUsedAt: { lt: new Date(now) } },
        data: { lastUsedAt: new Date(now) },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao atualizar lastUsedAt da sessão ${sid}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Lista as sessões ativas AGRUPADAS por dispositivo (V1):
   * - grupos = userId + deviceIdHash; representação = sessão mais recente;
   * - sessionCount = quantidade de sessões ativas do dispositivo;
   * - current=true se o sid do token pertence ao grupo;
   * - sessões legadas (deviceIdHash null) continuam aparecendo
   *   individualmente, uma linha cada.
   */
  async listActiveSessions(userId: string, currentSid: string | null | undefined) {
    const items = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    type Group = {
      key: string;
      rep: (typeof items)[number];
      sessions: (typeof items)[number][];
    };

    const byHash = new Map<string, Group>();
    const singles: Group[] = [];

    for (const s of items) {
      if (s.deviceIdHash) {
        let group = byHash.get(s.deviceIdHash);
        if (!group) {
          group = { key: s.deviceIdHash, rep: s, sessions: [] };
          byHash.set(s.deviceIdHash, group);
        }
        group.sessions.push(s);
      } else {
        singles.push({ key: `null:${s.id}`, rep: s, sessions: [s] });
      }
    }

    // rows já vêm desc; a primeira ocorrência de cada hash é a mais recente.
    const groups = [...byHash.values(), ...singles].sort((a, b) => {
      const byDate = b.rep.createdAt.getTime() - a.rep.createdAt.getTime();
      return byDate !== 0 ? byDate : a.rep.id.localeCompare(b.rep.id);
    });

    return {
      items: groups.map((group) => ({
        id: group.rep.id,
        deviceLabel: group.rep.deviceLabel,
        ipMasked: maskIp(group.rep.ip),
        userAgent: summarizeUserAgentResponse(group.rep.userAgent),
        createdAt: group.rep.createdAt,
        lastUsedAt: group.rep.lastUsedAt,
        expiresAt: group.rep.expiresAt,
        sessionCount: group.sessions.length,
        current: group.sessions.some((s) => s.id === currentSid),
      })),
    };
  }

  async revokeSession(id: string, userId: string) {
    const updated = await this.prisma.authSession.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: SessionRevokedReason.LOGOUT },
    });

    if (updated.count === 1) {
      return { message: 'Sessão encerrada.', revoked: true };
    }

    const exists = await this.prisma.authSession.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Sessão não encontrada.');
    }

    return { message: 'Sessão já encerrada.', revoked: false, alreadyRevoked: true };
  }

  /**
   * "Encerrar acesso deste dispositivo": revoga TODAS as sessões ativas
   * do grupo (userId + deviceIdHash) da sessão informada. Sempre filtrado
   * por userId — impossível alcançar sessões de outro usuário.
   * Sessões legadas (deviceIdHash null) revogam apenas a si mesmas,
   * preservando o comportamento anterior.
   */
  async revokeDevice(id: string, userId: string) {
    const session = await this.prisma.authSession.findFirst({
      where: { id, userId },
      select: { id: true, deviceIdHash: true },
    });

    if (!session) {
      throw new NotFoundException('Sessão não encontrada.');
    }

    const updated = await this.prisma.authSession.updateMany({
      where:
        session.deviceIdHash
          ? { userId, deviceIdHash: session.deviceIdHash, revokedAt: null }
          : { userId, id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: SessionRevokedReason.LOGOUT },
    });

    if (updated.count === 0) {
      return {
        message: 'Acesso deste dispositivo já encerrado.',
        revoked: false,
        alreadyRevoked: true,
      };
    }

    return {
      message:
        session.deviceIdHash && updated.count > 1
          ? `Acesso do dispositivo encerrado (${updated.count} sessões).`
          : 'Acesso deste dispositivo encerrado.',
      revoked: true,
      sessionsRevoked: updated.count,
    };
  }

  async revokeOthers(userId: string, currentSid: string | null | undefined) {
    const updated = await this.prisma.authSession.updateMany({
      where: { userId, id: { not: currentSid ?? '' }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: SessionRevokedReason.REVOKE_ALL },
    });

    return { message: 'Outras sessões encerradas.', revoked: updated.count };
  }

  async revokeCurrent(sid: string | null | undefined, userId: string) {
    if (sid) {
      await this.prisma.authSession.updateMany({
        where: { id: sid, userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: SessionRevokedReason.LOGOUT },
      });
    }

    return { message: 'Sessão encerrada.' };
  }

  async revokeAll(userId: string, reason: SessionRevokedReason) {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async getOverview(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        lastLoginAt: true,
        createdAt: true,
        emailVerified: true,
        emailVerifiedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const totalLogins = await this.prisma.loginHistory.count({
      where: { userId },
    });

    return {
      lastLoginAt: user.lastLoginAt,
      totalLogins,
      createdAt: user.createdAt,
      emailVerified: user.emailVerified,
      emailVerifiedAt: user.emailVerifiedAt,
    };
  }

  async listLogins(userId: string, query: ListLoginsQuery) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.loginHistory.count({ where: { userId } }),
      this.prisma.loginHistory.findMany({
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

  private sessionTtlMs(): number {
    const raw = this.config.get<string>('SESSION_EXPIRES_IN') ?? '7d';
    return parseDurationMs(raw);
  }

  private touchIntervalMs(): number {
    const raw = Number(this.config.get<string>('SESSION_TOUCH_INTERVAL_MS') ?? '');
    return raw > 0 ? raw : DEFAULT_TOUCH_INTERVAL_MS;
  }

  private pruneTouchCache() {
    const cutoff = Date.now() - DEFAULT_SESSION_EXPIRES_MS;
    for (const [sid, timestamp] of this.lastTouchAt) {
      if (timestamp < cutoff) {
        this.lastTouchAt.delete(sid);
      }
    }
  }
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(value.trim());
  if (!match) return DEFAULT_SESSION_EXPIRES_MS;

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

function toResponse(record: {
  id: string;
  ip: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
  createdAt: Date;
}) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    deviceLabel: record.deviceLabel,
    ipMasked: maskIp(record.ip),
    userAgent: summarizeUserAgentResponse(record.userAgent),
  };
}