// ---------------------------------------------------------------------------
// Maintenance cleanup job.
//
// Runs every 60s. Two responsibilities, both idempotent:
//
//   1. Close any open maintenance_windows whose ends_at has passed.
//      Sets enabled=false, closed_at=now(), closed_by='system'. Writes
//      an `expired` audit row per closed window. Invalidates cache.
//
//      This is OBSERVABILITY / CLEANUP ONLY — the resolver already
//      filters out expired rows via the SQL `ends_at IS NULL OR ends_at >
//      now()` clause. Worst case if this job is down: the row stays
//      marked enabled=true but is treated as inactive at lookup time.
//
//   2. Prune maintenance_response_cooldown rows older than 24h. Cooldown
//      is bounded by the per-window `cooldown_minutes` (max 1440 = 24h),
//      so anything older is dead weight.
//
// Pattern matches backend/src/jobs/subscription-expiry.ts and
// backend/src/jobs/trial-expiry.ts. Registered via registerJob() in
// backend/src/index.ts at boot.
// ---------------------------------------------------------------------------

import { registerJob } from '../lib/scheduler';
import { childLogger } from '../lib/logger';
import { getSupabase } from '../lib/supabase';
import { writeMaintenanceAudit } from '../lib/maintenance/audit';
import { invalidateAll } from '../lib/maintenance/cache';
import { purgeStaleCooldowns } from '../lib/maintenance/cooldown';

const log = childLogger('job.maintenance-cleanup');

interface ExpiredWindowRow {
  id: string;
  scope: 'global' | 'salon';
  salon_id: string | null;
  starts_at: string;
  ends_at: string;
}

export async function runOnce(): Promise<void> {
  try {
    const supabase = getSupabase();
    const nowIso = new Date().toISOString();

    // Step 1 — bulk close expired windows
    const { data: expiredRows, error: closeErr } = await supabase
      .from('maintenance_windows')
      .update({
        enabled: false,
        closed_at: nowIso,
        closed_by: 'system',
        updated_at: nowIso,
      })
      .eq('enabled', true)
      .not('ends_at', 'is', null)
      .lte('ends_at', nowIso)
      .select('id, scope, salon_id, starts_at, ends_at');

    if (closeErr) {
      log.error({ err: closeErr.message }, 'maintenance-cleanup: bulk close failed');
    } else {
      const rows = (expiredRows ?? []) as ExpiredWindowRow[];
      for (const row of rows) {
        const wasOpenForSec = Math.max(
          0,
          Math.floor((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 1000),
        );
        log.info(
          {
            scope: row.scope,
            salonId: row.salon_id,
            windowId: row.id,
            wasOpenForSec,
          },
          'maintenance.expired',
        );
        void writeMaintenanceAudit({
          windowId: row.id,
          businessId: row.salon_id,
          action: 'expired',
          actorId: null,
          actorType: 'system',
          scope: row.scope,
        });
      }
      if (rows.length > 0) {
        log.info(
          { count: rows.length },
          'maintenance-cleanup: closed expired windows',
        );
        invalidateAll();
      }
    }

    // Step 2 — purge stale cooldown rows
    await purgeStaleCooldowns();
  } catch (e) {
    log.error(
      { err: (e as Error).message },
      'maintenance-cleanup: runOnce threw (will retry next tick)',
    );
  }
}

export function startMaintenanceCleanupJob(): void {
  registerJob('maintenance-cleanup', runOnce, 60_000);
  log.info('maintenance-cleanup job registered (every 60s)');
}