import { SetMetadata } from '@nestjs/common';
import type { PlatformRole } from '@tontine/shared-types';

export const ROLES_KEY = 'roles';

/** Restreint une route à certains rôles plateforme. */
export const Roles = (...roles: PlatformRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
