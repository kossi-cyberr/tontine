import { z } from 'zod';

export const orderSchema = z.object({
  member_ids: z.array(z.string().uuid('Identifiant de membre invalide.')).min(2).max(100),
});
export type OrderInput = z.infer<typeof orderSchema>;
