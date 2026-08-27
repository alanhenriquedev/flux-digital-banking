import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { SecurityService } from '../../security/security.service';
import { AuthSession } from '@prisma/client';

type JwtPayload = {
  sub: string;
  sid?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly security: SecurityService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Token inválido.');
    }

    if (!payload.sid) {
      return {
        userId: payload.sub,
        sid: null,
      };
    }

    const session = await this.security.findSession(payload.sid);
    if (!this.isValidSession(session, payload.sub)) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    await this.security.touchSession(session.id);

    return {
      userId: session.userId,
      sid: session.id,
    };
  }

  private isValidSession(session: AuthSession | null, sub: string): session is AuthSession {
    if (!session) return false;
    if (session.userId !== sub) return false;
    if (session.revokedAt !== null) return false;
    return session.expiresAt.getTime() > Date.now();
  }
}