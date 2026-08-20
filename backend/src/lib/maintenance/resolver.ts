// ---------------------------------------------------------------------------
// getEffectiveMaintenanceState — the ONLY state read path for the
// Maintenance System Mode feature.
//
// Precedence:
//   1. If actorRole === 'superadmin', return bypassed state. This is used
//      only by the admin-state-preview endpoint and never affects customer
//      message gating (no customer message path has actorRole=superadmin).
//   2. Run two parallel indexed queries: global row + salon row.
//   3. Salon row wins over global row (salon-specific overrides global).
//   4. If no row, return disabled state.
//   5. On any DB exception: log loudly, write lookup_failed audit,
//      return FAIL-CLOSED inferred state with the hardcoded
//      FALLBACK_MAINTENANCE_MESSAGE. This deliberately diverges from
//      `isAgentActive`'s fail-open behavior.
//
// Runtime expiration:
//   The SQL `ends_at IS NULL OR ends_at > $now` clause enforces expiration
//   at lookup time. The cleanup cron is an optimization, never the source
//   of truth — a window past its ends_at is treated as inactive even if
//   the cron is down.
// ---------------------------------------------------------------------------

import { getSupabase } from '../supabase';
import { childLogger } from '../logger';
import { writeMaintenanceAudit } from './audit';
import {
  cacheKey,
  getCached,
  setCached,
  invalidate as invalidateCache,
} from './cache';
import {
  FALLBACK_MAINTENANCE_MESSAGE,
  type MaintenanceScope,
  type MaintenanceState,
} from './types';

const log = childLogger('maintenance.resolver');

export type MaintenanceActorRole =
  | 'superadmin'
  | 'business_owner'
  | 'staff'
  | 'system';

export interface ResolverArgs {
  /** null when looking up global-only state (admin preview). */
  salonId: string | null;
  actorRole: MaintenanceActorRole;
  /** Injectable for tests. Defaults to `new Date()`. */
  now?: Date;
  /** Skip cache read (admin write paths). */
  bypassCache?: boolean;
}

const DISABLED_STATE: MaintenanceState = {
  enabled: false,
  scope: 'global',
  bypassed: false,
  message: '',
  cooldownMinutes: 0,
  startsAt: null,
  endsAt: null,
  windowId: null,
  inferred: false,
};

function failClosedState(now: Date): MaintenanceState {
  return {
    enabled: true,
    scope: 'global',
    bypassed: false,
    message: FALLBACK_MAINTENANCE_MESSAGE,
    cooldownMinutes: 30,
    startsAt: null,
    endsAt: null,
    windowId: null,
    inferred: true,
  };
}

interface RawWindowRow {
  id: string;
  scope: MaintenanceScope;
  salon_id: string | null;
  message: string;
  cooldown_minutes: number;
  starts_at: string;
  ends_at: string | null;
}

function rowToState(row: RawWindowRow): MaintenanceState {
  return {
    enabled: true,
    scope: row.scope,
    bypassed: false,
    message: row.message,
    cooldownMinutes: row.cooldown_minutes,
    startsAt: new Date(row.starts_at),
    endsAt: row.ends_at ? new Date(row.ends_at) : null,
    windowId: row.id,
    inferred: false,
  };
}

/**
 * Resolve maintenance state for the given salon/actor.
 *
 * This is the only function that should ever query `maintenance_windows`.
 */
export async function getEffectiveMaintenanceState(
  args: ResolverArgs,
): Promise<MaintenanceState> {
  const now = args.now ?? new Date();

  // Rule 1: superadmin sees a bypassed state (for preview/inspection only).
  // Customer messages never carry actorRole='superadmin'.
  if (args.actorRole === 'superadmin') {
    return { ...DISABLED_STATE, bypassed: true };
  }

  const globalKey = cacheKey('global', null);
  const salonKey = args.salonId ? cacheKey('salon', args.salonId) : null;

  // Cache check
  if (!args.bypassCache) {
    const cachedGlobal = getCached(globalKey, now.getTime());
    const cachedSalon = salonKey ? getCached(salonKey, now.getTime()) : null;
    if (cachedSalon) return cachedSalon;          // salon wins regardless of cache miss on global
    if (cachedGlobal) return cachedGlobal;
  }

  // Rule 5: any DB exception → fail-closed inferred state
  try {
    const nowIso = now.toISOString();

    const globalQuery = getSupabase()
      .from('maintenance_windows')
      .select('id, scope, salon_id, message, cooldown_minutes, starts_at, ends_at')
      .eq('scope', 'global')
      .eq('enabled', true)
      .lte('starts_at', nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const salonQuery = args.salonId
      ? getSupabase()
          .from('maintenance_windows')
          .select('id, scope, salon_id, message, cooldown_minutes, starts_at, ends_at')
          .eq('scope', 'salon')
          .eq('salon_id', args.salonId)
          .eq('enabled', true)
          .lte('starts_at', nowIso)
          .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
          .order('starts_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const [globalRes, salonRes] = await Promise.all([globalQuery, salonQuery]);

    // Rule 5: query-level errors
    if (globalRes.error || salonRes.error) {
      const errMsg =
        globalRes.error?.message ??
        salonRes.error?.message ??
        'unknown maintenance lookup error';
      log.warn(
        {
          err: errMsg,
          salonId: args.salonId,
          actorRole: args.actorRole,
        },
        'maintenance.state_lookup_failed',
      );
      // Fire-and-forget audit
      void writeMaintenanceAudit({
        windowId: null,
        businessId: args.salonId,
        action: 'lookup_failed',
        actorId: null,
        actorType: 'system',
        scope: args.salonId ? 'salon' : 'global',
        metadata: { error: errMsg },
      });
      const inferred = failClosedState(now);
      setCached(globalKey, inferred);
      if (salonKey) setCached(salonKey, inferred);
      return inferred;
    }

    // Rule 3: salon row wins over global
    const salonRow = salonRes.data as RawWindowRow | null;
    const globalRow = globalRes.data as RawWindowRow | null;
    const winner = salonRow ?? globalRow;

    if (!winner) return DISABLED_STATE;

    const state = rowToState(winner);

    // Cache write
    setCached(globalKey, state);
    if (salonKey) setCached(salonKey, state);

    return state;
  } catch (e) {
    log.warn(
      {
        err: (e as Error).message,
        salonId: args.salonId,
        actorRole: args.actorRole,
      },
      'maintenance.state_lookup_failed',
    );
    void writeMaintenanceAudit({
      windowId: null,
      businessId: args.salonId,
      action: 'lookup_failed',
      actorId: null,
      actorType: 'system',
      scope: args.salonId ? 'salon' : 'global',
      metadata: { error: (e as Error).message },
    });
    const inferred = failClosedState(now);
    setCached(globalKey, inferred);
    if (salonKey) setCached(salonKey, inferred);
    return inferred;
  }
}

/**
 * Invalidate both global and salon cache entries. Called by admin write
 * paths and the cleanup cron.
 */
export function invalidateForSalon(salonId: string | null): void {
  invalidateCache(cacheKey('global', null));
  if (salonId) invalidateCache(cacheKey('salon', salonId));
}