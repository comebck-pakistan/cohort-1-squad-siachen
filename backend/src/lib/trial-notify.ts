// ---------------------------------------------------------------------------
// Trial notification helper — Wave 7 (Phase 4).
//
// Resolves the salon owner's personal WhatsApp number (from profiles.phone,
// NOT businesses.whatsapp_number which is the salon line itself) and hands
// off to the bridge-send helper. Used by the trial-expiry cron job to send
// the "your trial ends in 2 days" warning.
//
// Failure modes are non-fatal: if the owner has no WhatsApp, or the bridge
// is down, we just return {ok:false, error} so the cron job can log + skip
// (not crash the whole tick).
// ---------------------------------------------------------------------------

import { getSupabase } from './supabase';
import { bridgeSend } from './bridge-send';

export interface TrialNotifyResult {
  ok: boolean;
  error?: string;
}

export async function sendTrialWarningToOwner(
  businessId: string,
  text: string,
): Promise<TrialNotifyResult> {
  // Look up the owner's phone via businesses.owner_id → profiles.phone.
  // profiles.phone is plain E.164 digits (e.g. "923001234567") — the
  // bridge's sendTextMessage appends "@c.us" automatically when missing.
  const { data, error } = await getSupabase()
    .from('businesses')
    .select('owner_id, profiles!inner(phone)')
    .eq('id', businessId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: `lookup failed: ${error.message}` };
  }
  if (!data) {
    return { ok: false, error: 'business not found' };
  }

  // The Supabase typed join comes back as `profiles` being either an array
  // or single row depending on the relationship. Normalize.
  const profilesRaw = (data as unknown as { profiles: unknown }).profiles;
  const ownerRow = Array.isArray(profilesRaw)
    ? (profilesRaw as Array<{ phone: string | null }>)[0]
    : ((profilesRaw as { phone: string | null } | null) ?? null);
  const ownerPhone = ownerRow?.phone ?? null;

  if (!ownerPhone) {
    return { ok: false, error: 'owner phone not set' };
  }

  // The bridge prepends "@c.us" if missing. Pass the digits directly.
  const result = await bridgeSend(businessId, ownerPhone, text, { timeoutMs: 30_000 });
  return { ok: result.ok, error: result.error };
}
