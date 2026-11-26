import { z } from 'zod';

export const payContributionSchema = z.object({
  method: z.enum(['mtn_momo', 'orange_money', 'bank']),
  payer_number: z
    .string()
    .trim()
    .min(6, 'Numéro de paiement trop court.')
    .max(40, 'Numéro de paiement trop long.'),
});
export type PayContributionInput = z.infer<typeof payContributionSchema>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'Idempotency-Key doit contenir au moins 8 caractères.')
  .max(80, 'Idempotency-Key ne doit pas dépasser 80 caractères.');
