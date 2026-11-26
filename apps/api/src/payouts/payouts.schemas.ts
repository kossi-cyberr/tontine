import { z } from 'zod';

export const requestPayoutSchema = z
  .object({
    /** Règle souple uniquement : accepte un versement partiel du montant collecté. */
    allow_partial: z.boolean().optional(),
  })
  .optional()
  .transform((value) => value ?? { allow_partial: false });

export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export const approvePayoutSchema = z
  .object({
    /** Absent : l'API envoie d'abord un code OTP par SMS. */
    otp_code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Le code OTP doit contenir 6 chiffres.')
      .optional(),
  })
  .optional()
  .transform((value) => value ?? {});

export type ApprovePayoutInput = z.infer<typeof approvePayoutSchema>;
