import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PlatformRole } from '@tontine/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken, randomToken } from '../common/crypto.util';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface TokenContext {
  userAgent?: string;
  ip?: string;
}

interface RefreshRowUser {
  id: string;
  platform_role: PlatformRole;
  status: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get accessTtl(): number {
    return this.config.get<number>('JWT_ACCESS_TTL', 900);
  }

  private get refreshTtl(): number {
    return this.config.get<number>('JWT_REFRESH_TTL', 2_592_000);
  }

  async issuePair(
    user: { id: string; platform_role: PlatformRole },
    context: TokenContext = {},
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.platform_role },
      { expiresIn: this.accessTtl },
    );

    const refreshToken = randomToken(48);
    await this.prisma.refresh_tokens.create({
      data: {
        user_id: user.id,
        token_hash: hashToken(refreshToken),
        expires_at: new Date(Date.now() + this.refreshTtl * 1000),
        user_agent: context.userAgent?.slice(0, 500) ?? null,
        ip: context.ip ?? null,
      },
    });

    return { access_token: accessToken, refresh_token: refreshToken, expires_in: this.accessTtl };
  }

  /** Rotation : l'ancien refresh token est révoqué, un nouveau couple est émis. */
  async rotate(refreshToken: string, context: TokenContext = {}): Promise<TokenPair> {
    const row = await this.prisma.refresh_tokens.findFirst({
      where: { token_hash: hashToken(refreshToken) },
      include: { users: { select: { id: true, platform_role: true, status: true } } },
    });

    if (!row) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Session invalide. Reconnectez-vous.',
      });
    }

    if (row.revoked_at || row.expires_at.getTime() <= Date.now()) {
      // Jeton rejoué ou expiré : on révoque toutes les sessions par précaution.
      await this.revokeAll(row.user_id);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REVOKED',
        message: 'Session expirée. Reconnectez-vous.',
      });
    }

    const user = row.users as RefreshRowUser;
    if (user.status !== 'active') {
      await this.revokeAll(user.id);
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: "Ce compte n'est pas actif.",
      });
    }

    await this.prisma.refresh_tokens.update({
      where: { id: row.id },
      data: { revoked_at: new Date() },
    });

    return this.issuePair({ id: user.id, platform_role: user.platform_role }, context);
  }

  async revokeToken(refreshToken: string): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { token_hash: hashToken(refreshToken), revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }
}
