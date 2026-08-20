// ---------------------------------------------------------------------------
// Wave 20 — Global Notification types.
// Mirrors backend/src/lib/maintenance/types.ts conventions.
// ---------------------------------------------------------------------------

export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationActorType = "superadmin" | "system";
export type NotificationAuditAction = "created" | "updated" | "archived";

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  active: boolean;
  starts_at: string;             // ISO string
  ends_at: string | null;        // ISO string
  created_by: string | null;     // text — 'superadmin-secret' allowed
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

export interface NotificationAuditRow {
  id: string;
  notification_id: string | null;
  action: NotificationAuditAction;
  actor_id: string | null;
  actor_type: NotificationActorType;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface NotificationInput {
  title: string;
  body: string;
  severity: NotificationSeverity;
  startsAt?: string;
  endsAt?: string;
}

export interface NotificationPatch {
  title?: string;
  body?: string;
  severity?: NotificationSeverity;
  startsAt?: string;
  endsAt?: string;
}
