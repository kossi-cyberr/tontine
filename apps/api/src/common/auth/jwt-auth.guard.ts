import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthUser } from './current-user.decorator';

interface AccessTokenPayload {
  sub: string;
  role: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentification requise.',
      });
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Jeton invalide ou expiré.',
      });
    }

    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
      select: { id: true, platform_role: true, status: true },
    });

    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Compte introuvable.' });
    }
    if (user.status !== 'active') {
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: "Ce compte n'est pas actif.",
      });
    }

    request.user = { id: user.id, platform_role: user.platform_role };
    return true;
  }
}
