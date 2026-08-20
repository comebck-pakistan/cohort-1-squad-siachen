// ---------------------------------------------------------------------------
// maintenance-helpers.ts — pure helpers for the maintenance UI.
//
// No React, no network, no Date.now() baked in (callers pass `now` if they
// want a stable clock for tests). All formatting matches the design tokens
// in styles.css (pulse-dot, danger-soft, etc).
// ---------------------------------------------------------------------------

import type { MaintenanceAuditAction } from "@/types";

const SUPERADMIN_SENTINEL = "superadmin-secret";

/** Returns a human-readable countdown. Negative or null → "Expired" / "No expiry". */
export function formatRemainingTime(
  endsAt: string | null,
  now: number = Date.now(),
): string {
  if (!endsAt) return "No expiry";
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3_600);
  const minutes = Math.floor((totalSec % 3_600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Audit row actor is text — 'superadmin-secret' is the HMAC sentinel and
 * must be shown verbatim. Real UUIDs get the standard 8-char prefix.
 */
export function truncateActor(actorId: string | null): string {
  if (!actorId) return "system";
  if (actorId === SUPERADMIN_SENTINEL) return "superadmin";
  return actorId.slice(0, 8);
}

/**
 * Map audit action → badge variant. Centralised so all callers stay
 * consistent.
 *
 * Variants exist in `components/ui/badge.tsx` (default / secondary /
 * destructive / outline). Tones like danger-soft/warning-soft are layered
 * via className overrides at the call site.
 */
export function actionBadgeClass(action: MaintenanceAuditAction): string {
  switch (action) {
    case "enabled":
    case "updated":
      return "bg-warning-soft text-[oklch(0.4_0.12_85)] border-transparent";
    case "disabled":
    case "expired":
      return "bg-muted text-muted-foreground border-transparent";
    case "response_sent":
      return "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent";
    case "response_suppressed":
      return "bg-muted text-muted-foreground border-transparent";
    case "lookup_failed":
      return "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent";
    default:
      return "";
  }
}

/** Action labels for the audit log. */
export function actionLabel(action: MaintenanceAuditAction): string {
  switch (action) {
    case "enabled":
      return "Enabled";
    case "disabled":
      return "Disabled";
    case "updated":
      return "Updated";
    case "expired":
      return "Expired";
    case "response_sent":
      return "Reply sent";
    case "response_suppressed":
      return "Reply suppressed";
    case "lookup_failed":
      return "Lookup failed";
    default:
      return action;
  }
}

/** Convert a `<input type="datetime-local">` value (local string, no TZ) to ISO. */
export function localDateTimeToIso(local: string | null | undefined): string | undefined {
  if (!local) return undefined;
  // new Date("2026-08-19T12:00") interprets as LOCAL time → ISO round-trips correctly.
  const d = new Date(local);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Convert ISO → a "yyyy-MM-ddTHH:mm" local string for the input. */
export function isoToLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // toISOString gives UTC; we want local for the input. Build the string
  // manually so the input shows the user's wall-clock time, not UTC.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** "2 minutes from now" / "in 5 min" / "now" — used to show default endsAt. */
export function minutesFromNowIso(minutes: number, now: number = Date.now()): string {
  return new Date(now + minutes * 60_000).toISOString();
}

/** Validate a maintenance enable body client-side. Returns an error string or null. */
export interface EnableFormInput {
  message: string;
  cooldownMinutes: number;
  endsAtLocal: string;
  startsAtLocal: string;
  reason: string;
  salonId: string | null;
}

export interface EnableFormErrors {
  message?: string;
  cooldownMinutes?: string;
  salonId?: string;
  endsAt?: string;
}

export function validateEnableForm(input: EnableFormInput): EnableFormErrors {
  const errors: EnableFormErrors = {};
  const msg = input.message.trim();
  if (msg.length < 1) errors.message = "Required";
  else if (msg.length > 1000) errors.message = "Max 1000 characters";

  if (!Number.isFinite(input.cooldownMinutes) || input.cooldownMinutes < 0)
    errors.cooldownMinutes = "Must be 0 or more";
  else if (input.cooldownMinutes > 1440)
    errors.cooldownMinutes = "Max 1440 (24h)";

  if (input.endsAtLocal) {
    const d = new Date(input.endsAtLocal);
    if (isNaN(d.getTime())) errors.endsAt = "Invalid date";
    else if (d.getTime() <= Date.now())
      errors.endsAt = "Must be in the future";
  }

  if (input.reason.length > 500) errors.endsAt = "Reason max 500 characters";

  return errors;
}
