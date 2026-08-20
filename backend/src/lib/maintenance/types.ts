// ---------------------------------------------------------------------------
// Maintenance System Mode — domain types
//
// Mirrors the `payment_audit_log` pattern from `lib/payments.ts` and the
// existing gate-shape from `lib/message-handler.ts` (agent_paused /
// trial_expired / subscription_expired). Single source of truth for the
// maintenance feature's runtime shape.
//
// All identifiers are UUIDs except `created_by` / `closed_by`, which can be
// the superadmin HMAC sentinel `'superadmin-secret'` (non-UUID).
// ---------------------------------------------------------------------------

export type MaintenanceScope = 'global' | 'salon';
export type MaintenanceSource = 'admin' | 'system';
export type MaintenanceActorType = 'superadmin' | 'system';
export type MaintenanceAuditAction =
  | 'enabled'
  | 'disabled'
  | 'updated'
  | 'expired'
  | 'lookup_failed'
  | 'response_sent'
  | 'response_suppressed';

/**
 * The customer-facing maintenance reply, used as a hardcoded fallback when
 * the maintenance_windows table is unreachable. Distinct from any per-window
 * `message` so admins can tell "DB down" from "real maintenance" in logs.
 */
export const FALLBACK_MAINTENANCE_MESSAGE =
  "We're temporarily down for maintenance and will be back shortly. We'll get back to you as soon as we can.";

/**
 * The effective state returned by `getEffectiveMaintenanceState`.
 *
 * `inferred: true` indicates the state was computed under a DB error
 * (fail-closed). Callers should treat this as a transient signal — usually
 * a one-off blip — and the audit log will have a matching `lookup_failed`
 * row.
 */
export interface MaintenanceState {
  enabled: boolean;
  scope: MaintenanceScope;
  bypassed: boolean;
  message: string;
  cooldownMinutes: number;
  startsAt: Date | null;
  endsAt: Date | null;
  windowId: string | null;
  /** True when the state was derived under a DB error (fail-closed). */
  inferred: boolean;
}

export interface MaintenanceWindowRow {
  id: string;
  scope: MaintenanceScope;
  salon_id: string | null;
  enabled: boolean;
  reason: string | null;
  message: string;
  cooldown_minutes: number;
  starts_at: string;
  ends_at: string | null;
  source: MaintenanceSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
}

export interface MaintenanceAuditRow {
  id: string;
  window_id: string | null;
  business_id: string | null;
  action: MaintenanceAuditAction;
  actor_id: string | null;
  actor_type: MaintenanceActorType;
  scope: MaintenanceScope | null;
  affected_salons: string[] | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EnforcementResult {
  blocked: boolean;
  /** Fixed reply text when blocked and not suppressed by cooldown. */
  reply: string | null;
  state: MaintenanceState;
  /** True when maintenance is on AND the customer already received a
   * maintenance reply within `cooldownMinutes`. */
  suppressedByCooldown: boolean;
}