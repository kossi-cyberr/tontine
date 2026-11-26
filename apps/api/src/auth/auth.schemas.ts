import { z } from 'zod';

const phone = z
  .string()
  .trim()
  .regex(/^\+237\d{8,9}$/, 'Le téléphone doit être au format international, ex. +237650000000');

const password = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
  .regex(/[a-z]/, 'Le mot de passe doit contenir une minuscule.')
  .regex(/[A-Z]/, 'Le mot de passe doit contenir une majuscule.')
  .regex(/\d/, 'Le mot de passe doit contenir un chiffre.');

export const registerSchema = z.object({
  full_name: z.string().trim().min(2).max(150),
  phone,
  email: z.string().trim().toLowerCase().email().max(190).optional(),
  password,
  invite_code: z.string().trim().max(12).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyOtpSchema = z.object({
  target: z.string().trim().min(3).max(190),
  purpose: z.enum(['register', 'login', 'reset', 'payout_account', 'payout_approval']),
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const activateSchema = z.object({
  token: z.string().min(20),
  password,
});
export type ActivateInput = z.infer<typeof activateSchema>;

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(190),
  password: z.string().min(1),
  totp_code: z.string().length(6).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refresh_token: z.string().min(20),
});

export const logoutSchema = z.object({
  refresh_token: z.string().min(20).optional(),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(3).max(190),
});

export const resetPasswordSchema = z.object({
  identifier: z.string().trim().min(3).max(190),
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
  new_password: password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const updateProfileSchema = z
  .object({
    full_name: z.string().trim().min(2).max(150).optional(),
    email: z.string().trim().toLowerCase().email().max(190).optional(),
  })
  .refine((data) => data.full_name !== undefined || data.email !== undefined, {
    message: 'Aucun champ à mettre à jour.',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const payoutAccountSchema = z.object({
  type: z.enum(['mtn_momo', 'orange_money', 'bank']),
  account_number: z.string().trim().min(4).max(40),
  holder_name: z.string().trim().min(2).max(150),
  otp_code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/)
    .optional(),
});
export type PayoutAccountInput = z.infer<typeof payoutAccountSchema>;
