import { Injectable, type NestMiddleware } from '@nestjs/common';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { auditContext } from './audit-context';

function clientIp(request: Request): string | null {
  // `req.ip` respecte `trust proxy` configuré dans main.ts : sans proxy de
  // confiance, un en-tête X-Forwarded-For forgé ne peut pas fausser l'audit.
  const candidate = request.ip?.trim();
  if (!candidate) return null;
  return isIP(candidate) ? candidate : null;
}

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    const userAgent = request.headers['user-agent'];
    auditContext.run(
      {
        ip: clientIp(request),
        user_agent: typeof userAgent === 'string' ? userAgent.slice(0, 250) : null,
      },
      next,
    );
  }
}
