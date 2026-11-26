import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Format d'erreur unique de l'API : { code, message, details }.
 * `code` est stable et destiné au front, `message` est en français.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = this.toBody(exception, status);

    if (status >= 500) {
      // Journalisé par le logger applicatif ; on ne renvoie jamais la stack au client.
      console.error(`[${request.method} ${request.url}]`, exception);
    }

    response.status(status).json(body);
  }

  private toBody(exception: unknown, status: number): ApiErrorBody {
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { code: `HTTP_${status}`, message: payload };
      }

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const message = record['message'];

        return {
          code: typeof record['code'] === 'string' ? record['code'] : `HTTP_${status}`,
          message: Array.isArray(message)
            ? message.join(', ')
            : typeof message === 'string'
              ? message
              : exception.message,
          details: record['details'],
        };
      }

      return { code: `HTTP_${status}`, message: exception.message };
    }

    return {
      code: 'INTERNAL_ERROR',
      message: 'Une erreur interne est survenue. Veuillez réessayer plus tard.',
    };
  }
}
