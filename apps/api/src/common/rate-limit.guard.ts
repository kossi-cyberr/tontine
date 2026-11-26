import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'rateLimit';

import { SetMetadata } from '@nestjs/common';

/** Limite le nombre d'appels par IP sur une fenêtre glissante simple. */
export const RateLimit = (limit: number, windowMs: number): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs } satisfies RateLimitOptions);

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Limiteur en mémoire, suffisant pour un déploiement mono-instance et les tests.
 * Un compteur partagé Redis prendra le relais quand l'API sera répliquée.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();

    // Évite une croissance illimitée de la Map sous attaque multi-IP.
    if (this.buckets.size > 10_000) {
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }

    const key = `${request.ip ?? 'unknown'}:${request.method}:${request.path}`;
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }

    bucket.count += 1;
    if (bucket.count > options.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Trop de requêtes. Veuillez patienter avant de réessayer.',
          details: { retry_after_seconds: retryAfter },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
