import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Valide une entrée (body, query, params) avec un schéma zod.
 * En cas d'échec, renvoie une erreur 400 au format { code, message, details }.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Les données envoyées sont invalides.',
        details: result.error.flatten(),
      });
    }

    return result.data;
  }
}
