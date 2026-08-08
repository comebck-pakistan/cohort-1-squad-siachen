// ---------------------------------------------------------------------------
// Trial lifecycle helpers.
//
// Wave 7 (Phase 1) added trial_started_at, trial_ends_at, trial_status to
// businesses. This module is the read-side — a single source of truth that
// the bot enforcement (message-handler.ts), dashboard endpoint, scheduled
// job, and superadmin override all query through.
//
// Status transitions are managed by the cron job in jobs/trial-expiry.ts
// (hourly scan + WhatsApp warning). Manual transitions go through
// superadmin override endpoints. Read-side never writes.
// ---------------------------------------------------------------------------

import { getSupabase } from './supabase';

export type TrialStatus = 'active' | 'expiring_soon' | 'expired' | 'converted';

export interface TrialInfo {
  status: TrialStatus;
  /** ISO timestamp from businesses.trial_ends_at. NULL = no expiry set
   *  (pre-Wave-7 rows). */
  endsAt: string | null;
  /** ISO timestamp from businesses.trial_started_at. NULL = legacy row. */
  startedAt: string | null;
  /** True only when status is 'expired'. 'converted' rows return false. */
  isExpired: boolean;
  /** Days remaining (ceil). Negative values clamp to 0. NULL endsAt = null. */
  daysRemaining: number | null;
}

// Fail-open fallback. Returned when the row is missing or the query fails
// so a transient Supabase hiccup doesn't lock every salon out.
const SAFE_DEFAULT: TrialInfo = {
  status: 'active',
  endsAt: null,
  startedAt: null,
  isExpired: false,
  daysRemaining: null,
};

/**
 * Read the trial state for a salon. Used by:
 *   - message-handler.ts (bot enforcement — checks isExpired)
 *   - dashboard.ts (GET /api/business/:id/trial — full info for the UI)
 *   - jobs/trial-expiry.ts (cron — scans trial_ends_at ranges)
 *   - superadmin.ts (manual override — verifies pre-state)
 */
export async function getTrialInfo(businessId: string): Promise<TrialInfo> {
  try {
    const { data, error } = await getSupabase()
      .from('businesses')
      .select('trial_status, trial_ends_at, trial_started_at')
      .eq('id', businessId)
      .maybeSingle();

    if (error) {
      console.warn(
        `[trial.ts] getTrialInfo lookup failed (businessId=${businessId}):`,
        error.message,
      );
      return SAFE_DEFAULT;
    }
    if (!data) return SAFE_DEFAULT;

    const status = (data.trial_status ?? 'active') as TrialStatus;
    const endsAt = (data.trial_ends_at as string | null) ?? null;
    const startedAt = (data.trial_started_at as string | null) ?? null;
    const isExpired = status === 'expired';

    let daysRemaining: number | null = null;
    if (endsAt) {
      const ms = new Date(endsAt).getTime() - Date.now();
      // Clamp to 0 when past expiry (use ceil so day-0 is still visible).
      daysRemaining = Math.max(0, Math.ceil(ms / 86_400_000));
    }

    return { status, endsAt, startedAt, isExpired, daysRemaining };
  } catch (e) {
    console.warn(
      `[trial.ts] getTrialInfo threw (businessId=${businessId}):`,
      (e as Error).message,
    );
    return SAFE_DEFAULT;
  }
}

/**
 * Thin wrapper for the bot's hot path. True only when trial_status === 'expired'.
 * 'converted' rows (paid) return false so the bot stays responsive after upgrade.
 *
 * Fail-open semantics identical to isAgentActive — DB errors return false so
 * a transient Supabase outage doesn't silently break every salon's bot.
 */
export async function isTrialExpired(businessId: string): Promise<boolean> {
  const info = await getTrialInfo(businessId);
  return info.isExpired;
}
