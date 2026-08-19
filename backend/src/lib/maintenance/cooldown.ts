// ---------------------------------------------------------------------------
// Per-(salon, customer) cooldown for maintenance responses.
//
// The maintenance_response_cooldown table tracks when each pair last
// received a maintenance reply. `isInCooldown` is a single indexed probe;
// `recordCooldownSent` is an upsert. Both are best-effort — failures are
// logged, never thrown. A missing row means "no recent maintenance reply";
// a stale row would let a customer get an extra maintenance reply, which is
// the worst case (acceptable, not catastrophic).
//
// Phone normalization is intentionally trivial here — strip the @-suffix
// that whatsapp-web.js / Meta Cloud add to chat ids. We don't export
// normalizePhone across module boundaries to keep this self-contained.
// ---------------------------------------------------------------------------

import { getSupabase } from '../supabase';
import { childLogger } from '../logger';

const log = childLogger('maintenance.cooldown');

function normalizePhone(raw: string): string {
  const atIndex = raw.indexOf('@');
  return atIndex === -1 ? raw : raw.substring(0, atIndex);
}

/**
 * True when this (salon, customer) received a maintenance reply within the
 * last `cooldownMinutes` minutes. Cooldown is admin-configurable per
 * maintenance window.
 */
export async function isInCooldown(
  salonId: string,
  rawPhone: string,
  now: Date,
  cooldownMinutes: number,
): Promise<boolean> {
  if (cooldownMinutes <= 0) return false;
  const phone = normalizePhone(rawPhone);
  const threshold = new Date(now.getTime() - cooldownMinutes * 60_000).toISOString();

  try {
    const { data, error } = await getSupabase()
      .from('maintenance_response_cooldown')
      .select('last_sent_at')
      .eq('salon_id', salonId)
      .eq('customer_phone', phone)
      .maybeSingle();

    if (error) {
      log.warn(
        { err: error.message, salonId, phone },
        'cooldown lookup failed — treating as not in cooldown (best-effort)',
      );
      return false;
    }
    if (!data) return false;
    return data.last_sent_at > threshold;
  } catch (e) {
    log.warn(
      {
        err: (e as Error).message,
        salonId,
        phone,
      },
      'cooldown lookup threw — treating as not in cooldown (best-effort)',
    );
    return false;
  }
}

/**
 * Upsert the cooldown marker. Called after the FIRST maintenance reply is
 * sent to a (salon, customer) pair in a maintenance window.
 */
export async function recordCooldownSent(
  salonId: string,
  rawPhone: string,
  windowId: string | null,
  now: Date,
): Promise<void> {
  const phone = normalizePhone(rawPhone);
  try {
    const { error } = await getSupabase()
      .from('maintenance_response_cooldown')
      .upsert(
        {
          salon_id: salonId,
          customer_phone: phone,
          last_sent_at: now.toISOString(),
          last_window_id: windowId,
        },
        { onConflict: 'salon_id,customer_phone' },
      );
    if (error) {
      log.warn(
        { err: error.message, salonId, phone },
        'cooldown upsert failed (non-fatal)',
      );
    }
  } catch (e) {
    log.warn(
      { err: (e as Error).message, salonId, phone },
      'cooldown upsert threw (non-fatal)',
    );
  }
}

/**
 * Bulk-delete cooldown rows older than 24h. Called from the cleanup cron.
 * Safe to re-run (idempotent WHERE clause).
 */
export async function purgeStaleCooldowns(): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from('maintenance_response_cooldown')
      .delete()
      .lt('last_sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (error) {
      log.warn({ err: error.message }, 'cooldown purge failed (non-fatal)');
    }
  } catch (e) {
    log.warn(
      { err: (e as Error).message },
      'cooldown purge threw (non-fatal)',
    );
  }
}