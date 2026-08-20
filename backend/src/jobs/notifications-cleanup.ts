// ---------------------------------------------------------------------------
// Notifications cleanup job.
//
// Runs every 60s. Soft-archives any active notifications whose ends_at has
// passed. OBSERVABILITY / CLEANUP ONLY — the /active endpoint already filters
// out expired rows via the SQL `ends_at IS NULL OR ends_at > now()` clause,
// so this job is storage hygiene + keeps the admin list clean.
//
// Pattern matches backend/src/jobs/maintenance-cleanup.ts. Registered via
// registerJob() in backend/src/index.ts at boot.
// ---------------------------------------------------------------------------

import { registerJob } from '../lib/scheduler';
import { childLogger } from '../lib/logger';
import { getSupabase } from '../lib/supabase';
import { invalidateNotificationsCache } from '../lib/notifications/routes';

const log = childLogger('job.notifications-cleanup');

interface ExpiredRow {
  id: string;
  title: string;
}

export async function runOnce(): Promise<void> {
  try {
    const supabase = getSupabase();
    const nowIso = new Date().toISOString();

    // Step 1 — bulk-archive expired active notifications
    const { data: expired, error: fetchErr } = await supabase
      .from('global_notifications')
      .select('id, title')
      .eq('active', true)
      .not('ends_at', 'is', null)
      .lte('ends_at', nowIso);
    if (fetchErr) {
      log.warn({ err: fetchErr.message }, 'notifications-cleanup: fetch expired failed');
      return;
    }
    const rows = (expired ?? []) as ExpiredRow[];
    if (rows.length === 0) return;

    const { error: updateErr, count } = await supabase
      .from('global_notifications')
      .update({
        active: false,
        archived_at: nowIso,
        archived_by: 'system',
        updated_at: nowIso,
      })
      .eq('active', true)
      .not('ends_at', 'is', null)
      .lte('ends_at', nowIso);
    if (updateErr) {
      log.warn({ err: updateErr.message }, 'notifications-cleanup: bulk archive failed');
      return;
    }
    invalidateNotificationsCache();
    log.info(
      { archived: count ?? rows.length, ids: rows.map((r) => r.id) },
      'notifications-cleanup: archived expired notifications',
    );
  } catch (e) {
    log.warn(
      { err: (e as Error).message },
      'notifications-cleanup: threw (non-fatal)',
    );
  }
}

export function startNotificationsCleanupJob(): void {
  registerJob('notifications-cleanup', runOnce, 60_000);
  log.info('notifications-cleanup job registered (60s interval)');
}
