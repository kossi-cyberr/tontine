import { z } from 'zod';

export const orderSchema = z.object({
  member_ids: z.array(z.string().uuid('Identifiant de membre invalide.')).min(2).max(100),
});
export type OrderInput = z.infer<typeof orderSchema>;

export const openCycleSchema = z.object({
  /** Premier jour du cycle ; par défaut le lendemain de la fin du cycle précédent. */
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.')
    .optional(),
  /** Nouveau tirage au sort de l'ordre pour ce cycle. */
  redraw: z.boolean().optional(),
});
export type OpenCycleInput = z.infer<typeof openCycleSchema>;
