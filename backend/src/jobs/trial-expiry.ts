// ---------------------------------------------------------------------------
// Trial-expiry scheduled job — Wave 7 (Phase 4).
//
// Runs hourly. Two transitions:
//   (a) Find businesses whose trial_ends_at falls in [today, today+2 days]
//       with trial_status='active'. Send a WhatsApp warning to the owner,
//       then flip trial_status='expiring_soon' so subsequent ticks don't
//       re-send.
//   (b) Find businesses with trial_ends_at < now() AND trial_status IN
//       ('active', 'expiring_soon'). Flip to trial_status='expired' so
//       the bot's short-circuit kicks in on the next customer message.
//
// Idempotency:
//   - Warning only fires when status='active' AND ends_at within 2 days.
//     After flip to 'expiring_soon', no further warnings.
//   - Expire only fires when status IN ('active','expiring_soon') AND
//     ends_at < now(). Already-expired rows are skipped.
//
// Bridge-down handling: trial-notify returns {ok:false, error} and we log
// + skip. The next tick tries again. No crash, no infinite retry storm.
// ---------------------------------------------------------------------------

import { registerJob } from '../lib/scheduler';
import { getSupabase } from '../lib/supabase';
import { sendTrialWarningToOwner } from '../lib/trial-notify';
import { childLogger } from '../lib/logger';

const log = childLogger('job.trial-expiry');

const WARNING_TEXT =
  "Hi from Recepta! Your free trial ends in 2 days — reply 'UPGRADE' or visit hello@recepta.pk to continue receiving WhatsApp bookings.";

export function startTrialExpiryJob(): void {
  registerJob(
    'trial-expiry',
    runOnce,
    60 * 60 * 1000, // every hour
  );
  log.info('trial-expiry job registered (hourly)');
}

/**
 * Run one pass of the trial-expiry transitions. Exported for tests so
 * the same logic runs without waiting an hour. The cron registration
 * wraps this in registerJob().
 */
export async function runOnce(): Promise<void> {
  // ---- Query A: send warnings to trials ending in 0-2 days ---------------
  // Day 0 (today) included — gives a cushion for owners in different
  // timezones who might see "today ends" a few hours late.
  const nowIso = new Date().toISOString();
  const twoDaysOutIso = new Date(Date.now() + 2 * 86400_000).toISOString();

  const { data: upcoming, error: upcomingErr } = await getSupabase()
    .from('businesses')
    .select('id')
    .eq('trial_status', 'active')
    .gte('trial_ends_at', nowIso)
    .lte('trial_ends_at', twoDaysOutIso);

  if (upcomingErr) {
    log.error({ err: upcomingErr.message }, 'trial-expiry: upcoming query failed');
    // Continue — don't skip the expiry transition just because warnings failed.
  } else {
    for (const b of upcoming || []) {
      const result = await sendTrialWarningToOwner(b.id, WARNING_TEXT);
      if (result.ok) {
        // Flip status so we don't re-send next tick.
        const { error: flipErr } = await getSupabase()
          .from('businesses')
          .update({ trial_status: 'expiring_soon' })
          .eq('id', b.id);
        if (flipErr) {
          log.error(
            { businessId: b.id, err: flipErr.message },
            'trial-expiry: flip to expiring_soon failed (will retry next tick)',
          );
        } else {
          log.info({ businessId: b.id }, 'trial-expiry: warning sent, flipped to expiring_soon');
        }
      } else {
        // Bridge down / owner phone missing — log and skip. Next tick
        // will retry as long as status is still 'active'.
        log.warn(
          { businessId: b.id, err: result.error },
          'trial-expiry: warning send failed (will retry next tick)',
        );
      }
    }
  }

  // ---- Query B: flip overdue trials to expired --------------------------
  const { data: overdue, error: overdueErr } = await getSupabase()
    .from('businesses')
    .select('id')
    .in('trial_status', ['active', 'expiring_soon'])
    .lt('trial_ends_at', nowIso);

  if (overdueErr) {
    log.error({ err: overdueErr.message }, 'trial-expiry: overdue query failed');
    return;
  }

  if ((overdue || []).length > 0) {
    const ids = overdue!.map((b) => b.id);
    const { error: flipErr } = await getSupabase()
      .from('businesses')
      .update({ trial_status: 'expired' })
      .in('id', ids);
    if (flipErr) {
      log.error(
        { err: flipErr.message, count: ids.length },
        'trial-expiry: bulk flip to expired failed',
      );
    } else {
      log.info(
        { count: ids.length, businessIds: ids },
        'trial-expiry: flipped businesses to expired',
      );
      // Note: we intentionally do NOT tear down the bridge session
      // here. The plan's design is that the bot stays alive but sends
      // the fixed "trial ended" fallback for every customer message
      // (see message-handler.ts:283-314). Destroying the session would
      // break that path — the chromium has to stay alive for the
      // 'message' event to fire and reach the fallback short-circuit.
      // The defense against the duplicate-reply bug (two businesses
      // sharing one WhatsApp account) lives in:
      //   - routes/bridge.ts (Option 1): bootstrap filter excludes
      //     expired salons, so a dead salon never re-registers on
      //     bridge restart
      //   - ticket #296 (backlog): prevent two businesses from being
      //     paired to the same WhatsApp number in the first place
    }
  }
}
