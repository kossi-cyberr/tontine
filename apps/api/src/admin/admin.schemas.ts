import { z } from 'zod';

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
};

export const adminGroupsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['draft', 'recruiting', 'active', 'completed', 'cancelled']).optional(),
  ...pagination,
});
export type AdminGroupsQuery = z.infer<typeof adminGroupsQuerySchema>;

export const adminUsersQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  kyc: z.enum(['none', 'submitted', 'verified', 'rejected']).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'closed']).optional(),
  ...pagination,
});
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

export const kycDecisionSchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    reason: z.string().trim().min(5).max(500).optional(),
  })
  .refine((value) => value.decision !== 'rejected' || Boolean(value.reason), {
    message: 'Un motif est obligatoire en cas de rejet.',
    path: ['reason'],
  });
export type KycDecisionInput = z.infer<typeof kycDecisionSchema>;

export const settingsUpdateSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        value: z.unknown(),
      }),
    )
    .min(1)
    .max(20),
});
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export const auditLogsQuerySchema = z.object({
  actor_id: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  entity: z.string().trim().max(60).optional(),
  entity_id: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  ...pagination,
});
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;

export const cancelRoundSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
});
export type CancelRoundInput = z.infer<typeof cancelRoundSchema>;
