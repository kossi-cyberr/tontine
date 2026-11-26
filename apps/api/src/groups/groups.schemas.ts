import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

export const createGroupSchema = z
  .object({
    name: z.string().trim().min(3).max(150),
    description: z.string().trim().max(2000).optional(),
    rules_text: z.string().trim().max(10000).optional(),
    contribution_amount: z.coerce.number().int().min(1000).max(5_000_000),
    frequency: z.enum(['weekly', 'biweekly', 'monthly']),
    start_date: dateOnly,
    min_members: z.coerce.number().int().min(2).default(10),
    max_members: z.coerce.number().int().min(2).max(100).default(100),
    payout_rule: z.enum(['strict', 'flexible']).default('flexible'),
    beneficiary_pays: z.boolean().default(true),
    payment_deadline_days: z.coerce.number().int().min(0).max(30).default(2),
    late_fee_type: z.enum(['fixed', 'percent']).default('fixed'),
    late_fee_value: z.coerce.number().int().min(0).default(0),
    platform_fee_type: z.enum(['fixed', 'percent']).default('percent'),
    platform_fee_value: z.coerce.number().int().min(0).default(0),
    order_mode: z.enum(['random', 'manual']).default('random'),
    dual_approval_threshold: z.coerce.number().int().min(0).nullable().optional(),
  })
  .refine((data) => data.max_members >= data.min_members, {
    message: 'Le maximum de membres doit être supérieur ou égal au minimum.',
    path: ['max_members'],
  });
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = createGroupSchema.innerType().partial();
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const joinGroupSchema = z.object({
  invite_code: z.string().trim().min(4).max(12).toUpperCase(),
});

export const addMemberSchema = z.object({
  full_name: z.string().trim().min(2).max(150),
  phone: z
    .string()
    .trim()
    .regex(/^\+237\d{8,9}$/, 'Téléphone au format international, ex. +237650000000'),
  email: z.string().trim().toLowerCase().email().max(190).optional(),
  role: z.enum(['treasurer', 'member', 'observer']).default('member'),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const replaceMemberSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+237\d{8,9}$/, 'Numéro camerounais attendu (+237…).'),
  full_name: z.string().trim().min(2).max(150).optional(),
});
export type ReplaceMemberInput = z.infer<typeof replaceMemberSchema>;

export const memberRoleSchema = z.object({
  role: z.enum(['president', 'treasurer', 'member', 'observer']),
});

export const listMembersQuerySchema = z.object({
  status: z.enum(['invited', 'pending', 'active', 'suspended', 'left']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});
