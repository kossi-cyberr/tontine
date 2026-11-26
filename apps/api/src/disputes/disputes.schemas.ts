import { z } from 'zod';

export const createDisputeSchema = z.object({
  group_id: z.string().uuid(),
  round_id: z.string().uuid().optional(),
  payment_id: z.string().uuid().optional(),
  subject: z.string().trim().min(5, 'Le sujet doit contenir au moins 5 caractères.').max(190),
  description: z
    .string()
    .trim()
    .min(10, 'La description doit contenir au moins 10 caractères.')
    .max(5000),
  attachments: z
    .array(
      z
        .string()
        .url('Chaque pièce jointe doit être une URL valide.')
        .refine((value) => /^https?:\/\//i.test(value), {
          message: 'Seules les URLs HTTP et HTTPS sont acceptées.',
        }),
    )
    .max(5, 'Cinq pièces jointes au maximum.')
    .default([]),
});
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

export const listDisputesQuerySchema = z.object({
  status: z.enum(['open', 'in_review', 'resolved', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListDisputesQuery = z.infer<typeof listDisputesQuerySchema>;

export const updateDisputeSchema = z
  .object({
    status: z.enum(['in_review', 'resolved', 'rejected']),
    resolution: z.string().trim().min(10).max(5000).optional(),
  })
  .refine((value) => value.status === 'in_review' || Boolean(value.resolution), {
    message: 'Une décision motivée est obligatoire.',
    path: ['resolution'],
  });
export type UpdateDisputeInput = z.infer<typeof updateDisputeSchema>;
