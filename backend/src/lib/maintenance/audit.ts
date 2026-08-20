// ---------------------------------------------------------------------------
// Audit writer for Maintenance System Mode.
//
// Mirrors `writeAudit` in `backend/src/lib/payments.ts:164-186`:
//   - Wrapped in try/catch; never throws.
//   - On failure, `log.warn(...)` only — the user-facing action is the
//     source of truth.
//   - Application-side writes only (no DB trigger).
//
// Unlike `payment_audit_log.actor_id` (uuid), maintenance uses TEXT for
// actor_id because the superadmin HMAC sentinel `'superadmin-secret'` is
// not a valid UUID. We pass it through directly.
// ---------------------------------------------------------------------------

import { getSupabase } from '../supabase';
import { childLogger } from '../logger';
import type {
  MaintenanceActorType,
  MaintenanceAuditAction,
  MaintenanceScope,
} from './types';

const log = childLogger('maintenance.audit');

export interface MaintenanceAuditInput {
  windowId: string | null;
  businessId: string | null;
  action: MaintenanceAuditAction;
  actorId: string | null;
  actorType: MaintenanceActorType;
  scope: MaintenanceScope | null;
  affectedSalons?: string[];
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit write. Always returns void. Failures are logged,
 * never thrown.
 */
export async function writeMaintenanceAudit(input: MaintenanceAuditInput): Promise<void> {
  try {
    const { error } = await getSupabase().from('maintenance_audit_log').insert({
      window_id: input.windowId,
      business_id: input.businessId,
      action: input.action,
      actor_id: input.actorId,
      actor_type: input.actorType,
      scope: input.scope,
      affected_salons: input.affectedSalons ?? null,
      previous_state: input.previousState ?? null,
      new_state: input.newState ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) {
      log.warn(
        { err: error.message, action: input.action, windowId: input.windowId },
        'maintenance audit log write failed (non-fatal)',
      );
    }
  } catch (e) {
    log.warn(
      {
        err: (e as Error).message,
        action: input.action,
        windowId: input.windowId,
      },
      'maintenance audit log threw (non-fatal)',
    );
  }
}