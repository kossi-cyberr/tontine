import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PlatformRole } from '@tontine/shared-types';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  platform_role: PlatformRole;
}

/** Utilisateur authentifié, injecté depuis le jeton vérifié (jamais depuis le client). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!request.user) {
      throw new Error('CurrentUser utilisé hors d’une route protégée');
    }
    return request.user;
  },
);
