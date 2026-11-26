import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@tontine/shared-types';
import type { Request } from 'express';
import type { AuthUser } from './current-user.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!request.user || !required.includes(request.user.platform_role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
    return true;
  }
}
