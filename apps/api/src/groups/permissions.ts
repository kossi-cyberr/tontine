import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { GroupRole, PlatformRole } from '@tontine/shared-types';

export interface Membership {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupRole;
  status: string;
}

export interface Actor {
  id: string;
  platform_role: PlatformRole;
}

export function isPlatformAdmin(actor: Actor): boolean {
  return actor.platform_role === 'super_admin';
}

/** Rôles autorisés à administrer un groupe (hors Super Admin). */
export const MANAGER_ROLES: GroupRole[] = ['president'];

export function assertGroupManager(actor: Actor, membership: Membership | null): void {
  if (isPlatformAdmin(actor)) return;
  if (!membership || membership.status !== 'active' || !MANAGER_ROLES.includes(membership.role)) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Seul le président du groupe peut effectuer cette action.',
    });
  }
}

export function assertGroupMember<T extends { status: string }>(membership: T | null): T {
  if (!membership || membership.status !== 'active') {
    throw new ForbiddenException({
      code: 'NOT_A_MEMBER',
      message: 'Vous ne faites pas partie de ce groupe.',
    });
  }
  return membership;
}

export function notFoundGroup(): never {
  throw new NotFoundException({
    code: 'GROUP_NOT_FOUND',
    message: 'Groupe introuvable.',
  });
}
