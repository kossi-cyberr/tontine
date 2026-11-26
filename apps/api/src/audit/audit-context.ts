import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditRequestContext {
  ip: string | null;
  user_agent: string | null;
}

/** Contexte de la requête courante, utilisé pour enrichir le journal d'audit. */
export const auditContext = new AsyncLocalStorage<AuditRequestContext>();
