// ---------------------------------------------------------------------------
// Superadmin endpoints — platform-level management.
// Used by the Recepta frontend's /superadmin/* routes.
//
// Field-name adapter: the DB column is `billing_state` (matches
// billing_state enum); the Recepta frontend uses `billing_status`. We
// rename at the API boundary so the React Query layer doesn't have to.
//
// Endpoints:
//   GET    /api/salons
//   POST   /api/salons
//   PATCH  /api/salons/:id
//   DELETE /api/salons/:id
//   PATCH  /api/salons/:id/agent
//   GET    /api/audit
//   GET    /api/kpis
//   GET    /api/revenue
//   GET    /api/payments
//   GET    /api/settings/tiers
//   PATCH  /api/settings/tiers
//   GET    /api/settings/safety
//   PATCH  /api/settings/safety
//   GET    /onboarding/:businessId/status
//
// All require JWT + role='superadmin' on the calling profile.
// ---------------------------------------------------------------------------

import { Router, Request, Response, RequestHandler } from 'express';
import { getSupabase } from '../lib/supabase';
import { requireAuth } from '../lib/auth';
import { childLogger } from '../lib/logger';

const router = Router();

// ---------------------------------------------------------------------------
// requireSuperadmin — checks the caller's profiles.role === 'superadmin'
// ---------------------------------------------------------------------------

const requireSuperadmin: RequestHandler = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.isSuperadmin) return next();
  const supabase = getSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  return next();
};

// Wrap (requireAuth, requireSuperadmin) as a single middleware array
const authSuper = [requireAuth, requireSuperadmin] as const;

const log = childLogger('superadmin');

// ---------------------------------------------------------------------------
// Business shape adapter: DB row → Recepta frontend's Business type
// ---------------------------------------------------------------------------

interface BusinessRow {
  id: string;
  name: string;
  tier: 'basic' | 'pro' | 'business';
  phone_number_id: string | null;
  whatsapp_number: string | null;
  billing_state: 'active' | 'grace_period' | 'suspended';
  city: string | null;
  agent_active: boolean;
  created_at: string;
  owner_id?: string | null;
  // Wave 7 (Phase 5) — trial lifecycle. NULL ends_at = pre-Wave-7 row,
  // grandfathered as "no trial". Status defaults to 'active' from the
  // migration's column default.
  trial_status?: 'active' | 'expiring_soon' | 'expired' | 'converted';
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
}

interface AdaptedBusiness {
  id: string;
  name: string;
  tier: 'basic' | 'pro' | 'business';
  phone_number_id?: string;
  whatsapp_number: string;
  billing_status: 'active' | 'grace_period' | 'suspended';
  city?: string;
  agent_active: boolean;
  created_at: string;
  // Wave 7 (Phase 5) — trial lifecycle + computed days remaining.
  trial_status?: 'active' | 'expiring_soon' | 'expired' | 'converted';
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  days_remaining?: number | null;
  // Computed values (computed in GET /api/salons; absent on writes)
  messages_month?: number;
  mrr_pkr?: number;
}

function adaptBusiness(
  row: BusinessRow,
  extras: { messages_month?: number; mrr_pkr?: number } = {}
): AdaptedBusiness {
  // Compute days_remaining server-side — saves the frontend from
  // duplicating the timezone math. NULL endsAt → NULL days_remaining
  // (pre-Wave-7 rows).
  let days_remaining: number | null = null;
  if (row.trial_ends_at) {
    const ms = new Date(row.trial_ends_at).getTime() - Date.now();
    days_remaining = Math.max(0, Math.ceil(ms / 86_400_000));
  }
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    phone_number_id: row.phone_number_id ?? undefined,
    whatsapp_number: row.whatsapp_number ?? '',
    billing_status: row.billing_state,
    city: row.city ?? undefined,
    agent_active: row.agent_active,
    created_at: row.created_at,
    trial_status: row.trial_status,
    trial_started_at: row.trial_started_at ?? null,
    trial_ends_at: row.trial_ends_at ?? null,
    days_remaining,
    ...extras,
  };
}

// Compute messages_month (last 30d) + mrr_pkr for a set of businesses
async function computeBusinessMetrics(
  businessIds: string[]
): Promise<Map<string, { messages_month: number; mrr_pkr: number }>> {
  const out = new Map<string, { messages_month: number; mrr_pkr: number }>();
  if (businessIds.length === 0) return out;

  const supabase = getSupabase();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // messages_month = count of customer messages in last 30 days, grouped by business
  // (joining through conversations to get business_id)
  const { data: msgRows } = await supabase
    .from('messages')
    .select('conversation:conversations(business_id)')
    .eq('sender_type', 'customer')
    .gte('created_at', since);

  const msgByBiz = new Map<string, number>();
  for (const r of (msgRows || []) as unknown as Array<{
    conversation: { business_id: string } | null;
  }>) {
    if (r.conversation) {
      msgByBiz.set(
        r.conversation.business_id,
        (msgByBiz.get(r.conversation.business_id) || 0) + 1
      );
    }
  }

  // mrr_pkr = sum of monthly_price for active subscriptions per business
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('business_id, monthly_price')
    .is('cancelled_at', null);

  const subByBiz = new Map<string, number>();
  for (const s of (subs || []) as Array<{
    business_id: string;
    monthly_price: number | string;
  }>) {
    const price = Number(s.monthly_price) || 0;
    subByBiz.set(
      s.business_id,
      (subByBiz.get(s.business_id) || 0) + price
    );
  }

  for (const id of businessIds) {
    out.set(id, {
      messages_month: msgByBiz.get(id) || 0,
      mrr_pkr: subByBiz.get(id) || 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. GET /api/salons
// ---------------------------------------------------------------------------
router.get('/salons', ...authSuper, async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, tier, phone_number_id, whatsapp_number, billing_state, city, agent_active, created_at, owner_id, trial_status, trial_started_at, trial_ends_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []) as BusinessRow[];
  const metrics = await computeBusinessMetrics(rows.map((r) => r.id));
  const adapted = rows.map((r) =>
    adaptBusiness(r, metrics.get(r.id) || { messages_month: 0, mrr_pkr: 0 })
  );
  return res.json(adapted);
});

// ---------------------------------------------------------------------------
// 1b. PATCH /api/salons/:id/trial/extend
//
// Wave 7 (Phase 5) — manual trial override. Pushes trial_ends_at forward
// by `days` (1-365, validated) and resets trial_status to 'active' so
// the cron job won't immediately re-flip to 'expired'. Used by the
// superadmin SalonsTab "Extend +7 days" button.
//
// We do NOT touch billing_state — this is a courtesy extension, not a
// conversion. To actually convert a salon to a paid customer, use the
// /trial/convert endpoint below.
// ---------------------------------------------------------------------------
router.patch(
  '/salons/:id/trial/extend',
  ...authSuper,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = (req.body || {}) as { days?: unknown };
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res
        .status(400)
        .json({ error: 'days must be an integer between 1 and 365' });
    }

    const supabase = getSupabase();
    // We used to call an RPC named extend_trial here, but that function
    // was never installed in the DB and the dead-call path was triggering
    // a 500 (the "function does not exist" regex didn't match PostgREST's
    // actual "not found in schema cache" wording). The manual read+update
    // below is the correct path and avoids the round-trip entirely.
    //
    // Logic: extend from the CURRENT trial_ends_at when it's still in the
    // future; otherwise anchor to now() so a stale/expired row gets a fresh
    // 7-day window. Always reset trial_status to 'active' so the cron job
    // won't immediately re-flip to 'expired'.
    const { data: existing } = await supabase
      .from('businesses')
      .select('trial_ends_at')
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      return res.status(404).json({ error: 'Business not found' });
    }
    const baseIso =
      existing.trial_ends_at && new Date(existing.trial_ends_at) > new Date()
        ? existing.trial_ends_at
        : new Date().toISOString();
    const newEnds = new Date(
      new Date(baseIso).getTime() + days * 86400_000,
    ).toISOString();
    const { data: updated, error: updErr } = await supabase
      .from('businesses')
      .update({ trial_ends_at: newEnds, trial_status: 'active' })
      .eq('id', id)
      .select('id, trial_status, trial_ends_at')
      .single();

    if (updErr || !updated) {
      log.error({ err: updErr, id }, 'extend-trial update failed');
      return res
        .status(500)
        .json({ error: updErr?.message || 'extend failed' });
    }
    log.info(
      { businessId: id, days, newEndsAt: newEnds },
      'superadmin: extended trial',
    );
    return res.json({
      ok: true,
      business_id: updated.id,
      trial_status: updated.trial_status,
      trial_ends_at: updated.trial_ends_at,
    });
  }
);

// ---------------------------------------------------------------------------
// 1c. POST /api/salons/:id/trial/convert
//
// Wave 7 (Phase 5) — mark a trial as converted (paid). Sets trial_status
// to 'converted' so the bot's short-circuit treats them as fully paid
// (no trial enforcement). We do NOT clear trial_ends_at — leaving the
// historical timestamp lets us audit "when did this user originally
// sign up" if needed.
// ---------------------------------------------------------------------------
router.post(
  '/salons/:id/trial/convert',
  ...authSuper,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('businesses')
      .update({ trial_status: 'converted' })
      .eq('id', id)
      .select('id, trial_status, trial_ends_at')
      .single();
    if (error || !data) {
      log.error({ err: error, id }, 'convert-trial failed');
      return res
        .status(500)
        .json({ error: error?.message || 'convert failed' });
    }
    log.info({ businessId: id }, 'superadmin: trial converted (paid)');
    return res.json({
      ok: true,
      business_id: data.id,
      trial_status: data.trial_status,
      trial_ends_at: data.trial_ends_at,
    });
  }
);

// ---------------------------------------------------------------------------
// 2. POST /api/salons
// ---------------------------------------------------------------------------
router.post('/salons', ...authSuper, async (req: Request, res: Response) => {
  const {
    name,
    tier = 'basic',
    phoneNumberId,
    systemAccessToken,
    whatsappNumber,
    city,
  } = req.body as {
    name?: string;
    tier?: 'basic' | 'pro' | 'business';
    phoneNumberId?: string;
    systemAccessToken?: string;
    whatsappNumber?: string;
    city?: string;
  };

  if (!name || !whatsappNumber) {
    return res.status(400).json({ error: 'name and whatsappNumber are required' });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('businesses')
    .insert({
      name,
      tier,
      phone_number_id: phoneNumberId ?? null,
      access_token: systemAccessToken ?? null,
      whatsapp_number: whatsappNumber,
      city: city ?? null,
      agent_active: true,
    })
    .select('id, name, tier, phone_number_id, whatsapp_number, billing_state, city, agent_active, created_at, owner_id')
    .single();

  if (error || !data) {
    return res.status(500).json({ error: error?.message || 'Insert failed' });
  }
  return res.status(201).json(adaptBusiness(data as BusinessRow, { messages_month: 0, mrr_pkr: 0 }));
});

// ---------------------------------------------------------------------------
// 3. PATCH /api/salons/:id
// ---------------------------------------------------------------------------
router.patch('/salons/:id', ...authSuper, async (req: Request, res: Response) => {
  const { id } = req.params;
  const patch = req.body as Partial<{
    name: string;
    tier: 'basic' | 'pro' | 'business';
    phone_number_id: string;
    whatsapp_number: string;
    city: string;
    billing_state: 'active' | 'grace_period' | 'suspended';
    agent_active: boolean;
  }>;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('businesses')
    .update(patch)
    .eq('id', id)
    .select('id, name, tier, phone_number_id, whatsapp_number, billing_state, city, agent_active, created_at, owner_id')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Business not found' });

  const metrics = await computeBusinessMetrics([id]);
  return res.json(adaptBusiness(data as BusinessRow, metrics.get(id) || { messages_month: 0, mrr_pkr: 0 }));
});

// ---------------------------------------------------------------------------
// 4. DELETE /api/salons/:id
//    Soft-delete: set agent_active=false + billing_state='suspended' so
//    we keep the audit trail. Hard-delete would orphan conversations +
//    appointments. Reactivation is just PATCH back to 'active'.
// ---------------------------------------------------------------------------
router.delete('/salons/:id', ...authSuper, async (req: Request, res: Response) => {
  const { id } = req.params;
  const supabase = getSupabase();
  const { error } = await supabase
    .from('businesses')
    .update({ agent_active: false, billing_state: 'suspended' })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ id, suspended: true });
});

// ---------------------------------------------------------------------------
// 5. PATCH /api/salons/:id/agent
//    Kill switch for the AI receptionist. Suspended tenants can't be
//    re-enabled here — they must go through billing reactivation.
// ---------------------------------------------------------------------------
router.patch('/salons/:id/agent', ...authSuper, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { active } = req.body as { active?: boolean };
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active (boolean) is required' });
  }

  const supabase = getSupabase();
  // Load current state to enforce "suspended → can't reactivate" rule
  const { data: current } = await supabase
    .from('businesses')
    .select('billing_state')
    .eq('id', id)
    .maybeSingle();
  if (!current) return res.status(404).json({ error: 'Business not found' });

  const nextActive =
    current.billing_state === 'suspended' ? false : active;

  const { data, error } = await supabase
    .from('businesses')
    .update({ agent_active: nextActive })
    .eq('id', id)
    .select('id, name, tier, phone_number_id, whatsapp_number, billing_state, city, agent_active, created_at, owner_id')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Business not found' });

  const metrics = await computeBusinessMetrics([id]);
  return res.json(adaptBusiness(data as BusinessRow, metrics.get(id) || { messages_month: 0, mrr_pkr: 0 }));
});

// ---------------------------------------------------------------------------
// 6. GET /api/audit
//    Synthesized from escalation_events + recent bookings for the
//    audit feed in /superadmin. Each row tagged with kind so the UI
//    can color-code.
// ---------------------------------------------------------------------------
router.get('/audit', ...authSuper, async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  const limit = Math.min(parseInt((_req.query.limit as string) || '50', 10), 200);

  // Escalation events (last 14 days) — kind='system' or 'message'
  const { data: escalations } = await supabase
    .from('escalation_events')
    .select(`
      id, reason, created_at, resolved,
      conversation:conversations(
        business_id,
        business:businesses(name)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Recent bookings — kind='booking'
  const { data: bookings } = await supabase
    .from('appointments')
    .select(`
      id, status, created_at, start_time,
      service:services(name),
      customer:customers(name),
      conversation:conversations(
        business_id,
        business:businesses(name)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  type AuditEvent = {
    id: string;
    business_id: string;
    business_name: string;
    kind: 'message' | 'booking' | 'billing' | 'system';
    summary: string;
    created_at: string;
  };

  const events: AuditEvent[] = [];

  for (const e of (escalations || []) as unknown as Array<{
    id: string;
    reason: string;
    created_at: string;
    resolved: boolean;
    conversation: {
      business_id: string;
      business: { name: string } | null;
    } | null;
  }>) {
    if (!e.conversation) continue;
    events.push({
      id: e.id,
      business_id: e.conversation.business_id,
      business_name: e.conversation.business?.name ?? '(unknown)',
      kind: 'system',
      summary: e.resolved
        ? `Resolved escalation: ${e.reason}`
        : `Escalation raised: ${e.reason}`,
      created_at: e.created_at,
    });
  }

  for (const b of (bookings || []) as unknown as Array<{
    id: string;
    status: string;
    created_at: string;
    service: { name: string } | null;
    customer: { name: string } | null;
    conversation: {
      business_id: string;
      business: { name: string } | null;
    } | null;
  }>) {
    if (!b.conversation) continue;
    events.push({
      id: b.id,
      business_id: b.conversation.business_id,
      business_name: b.conversation.business?.name ?? '(unknown)',
      kind: 'booking',
      summary: `Booking ${b.status} — ${b.service?.name ?? 'service'} for ${b.customer?.name ?? 'customer'}`,
      created_at: b.created_at,
    });
  }

  // Sort newest first, return top `limit`
  events.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return res.json(events.slice(0, limit));
});

// ---------------------------------------------------------------------------
// 7. GET /api/kpis
//    Platform-wide totals for /superadmin Overview tab.
// ---------------------------------------------------------------------------
router.get('/kpis', ...authSuper, async (_req: Request, res: Response) => {
  const supabase = getSupabase();

  // Active salons
  const { count: activeSalons } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .eq('billing_state', 'active');

  // Messages delivered in last 30 days
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: messagesDelivered } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_type', 'agent')
    .gte('created_at', since);

  // Revenue (sum of active subscriptions)
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('monthly_price')
    .is('cancelled_at', null);
  const revenuePKR = (subs || []).reduce(
    (sum, s) => sum + (Number(s.monthly_price) || 0),
    0
  );

  // Pending cases = unresolved escalations
  const { count: pendingCases } = await supabase
    .from('escalation_events')
    .select('id', { count: 'exact', head: true })
    .eq('resolved', false);

  return res.json({
    messagesDelivered: messagesDelivered || 0,
    revenuePKR,
    pendingCases: pendingCases || 0,
    activeSalons: activeSalons || 0,
  });
});

// ---------------------------------------------------------------------------
// 8. GET /api/revenue
//    Monthly revenue time series (last 6 months) for the chart.
//    Synthesized from subscriptions.started_at.
// ---------------------------------------------------------------------------
router.get('/revenue', ...authSuper, async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('monthly_price, started_at, cancelled_at');

  type RevenuePoint = { month: string; revenue: number };

  // Bucket by month-of-started_at — for MVP, treat all active subs as
  // counted in their start month + every month after (until cancelled).
  const buckets: Record<string, number> = {};
  const now = new Date();
  const monthLabels: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'short' });
    buckets[key] = 0;
    monthLabels.push(label);
  }

  for (const s of (subs || []) as Array<{
    monthly_price: number | string;
    started_at: string;
    cancelled_at: string | null;
  }>) {
    const start = new Date(s.started_at);
    const end = s.cancelled_at ? new Date(s.cancelled_at) : now;
    const price = Number(s.monthly_price) || 0;

    // For each month in the chart window, count this sub if it overlaps
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      if (start < monthEnd && end >= monthStart) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        buckets[key] = (buckets[key] || 0) + price;
      }
    }
  }

  const series: RevenuePoint[] = monthLabels.map((label, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { month: label, revenue: buckets[key] || 0 };
  });

  return res.json(series);
});

// ---------------------------------------------------------------------------
// 9. GET /api/payments
//    Last N subscription events. Real money movement would come from
//    a Stripe/JazzCash webhook — for MVP we synthesize from subscription
//    start/cancel events.
// ---------------------------------------------------------------------------
router.get('/payments', ...authSuper, async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  const limit = Math.min(parseInt((_req.query.limit as string) || '50', 10), 200);

  const { data: subs } = await supabase
    .from('subscriptions')
    .select(`
      id, monthly_price, started_at, cancelled_at,
      business:businesses(name)
    `)
    .order('started_at', { ascending: false })
    .limit(limit);

  type PaymentLog = {
    id: string;
    business_name: string;
    amount_pkr: number;
    status: 'paid' | 'pending' | 'failed';
    method: string;
    created_at: string;
  };

  const payments: PaymentLog[] = [];
  for (const s of (subs || []) as unknown as Array<{
    id: string;
    monthly_price: number | string;
    started_at: string;
    cancelled_at: string | null;
    business: { name: string } | null;
  }>) {
    payments.push({
      id: `${s.id}-start`,
      business_name: s.business?.name ?? '(unknown)',
      amount_pkr: Number(s.monthly_price) || 0,
      status: 'paid',
      method: 'Card',
      created_at: s.started_at,
    });
    if (s.cancelled_at) {
      payments.push({
        id: `${s.id}-cancel`,
        business_name: s.business?.name ?? '(unknown)',
        amount_pkr: Number(s.monthly_price) || 0,
        status: 'failed',
        method: 'Card',
        created_at: s.cancelled_at,
      });
    }
  }

  payments.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return res.json(payments.slice(0, limit));
});

// ---------------------------------------------------------------------------
// 10. GET /api/settings/tiers + PATCH /api/settings/tiers
//     Tier configuration. DB columns: max_appointments_mo, max_messages_mo,
//     max_staff_members, max_custom_rules, allow_client_card_payments,
//     allow_reminders, allow_human_handoff.
//     Frontend expects: monthlyMessages, concurrentAgents, pricePKR.
// ---------------------------------------------------------------------------
const tierRowToFrontend = (row: {
  tier: 'basic' | 'pro' | 'business';
  max_messages_mo: number;
  max_staff_members: number;
  monthly_price?: number;
}) => ({
  tier: row.tier,
  monthlyMessages: row.max_messages_mo,
  concurrentAgents: row.max_staff_members, // staff_members ≈ agents
  pricePKR: row.monthly_price ?? 0,
});

router.get('/settings/tiers', ...authSuper, async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  const { data: tiers, error } = await supabase
    .from('tier_limits')
    .select('tier, max_messages_mo, max_staff_members')
    .order('tier');
  if (error) return res.status(500).json({ error: error.message });

  // Pull price per tier from active subscriptions (or default 0)
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('tier, monthly_price')
    .is('cancelled_at', null);
  const priceByTier: Record<string, number> = {};
  for (const s of (subs || []) as Array<{ tier: string; monthly_price: number | string }>) {
    priceByTier[s.tier] = Math.max(priceByTier[s.tier] || 0, Number(s.monthly_price) || 0);
  }

  const out = ((tiers || []) as Array<{
    tier: 'basic' | 'pro' | 'business';
    max_messages_mo: number;
    max_staff_members: number;
  }>).map((t) =>
    tierRowToFrontend({ ...t, monthly_price: priceByTier[t.tier] || 0 })
  );

  return res.json(out);
});

router.patch('/settings/tiers', ...authSuper, async (req: Request, res: Response) => {
  const rows = req.body as Array<{
    tier: 'basic' | 'pro' | 'business';
    monthlyMessages: number;
    concurrentAgents: number;
    pricePKR: number;
  }>;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Expected an array of tier rows' });
  }

  const supabase = getSupabase();
  // Update tier_limits rows + upsert a price sentinel subscription row
  // (real implementation: drive price from billing provider config)
  for (const r of rows) {
    const { error } = await supabase
      .from('tier_limits')
      .update({
        max_messages_mo: r.monthlyMessages,
        max_staff_members: r.concurrentAgents,
      })
      .eq('tier', r.tier);
    if (error) return res.status(500).json({ error: error.message });
    // pricePKR persistence is via subscriptions table — out of scope for
    // MVP, just return the input value back
  }
  return res.json(rows);
});

// ---------------------------------------------------------------------------
// 11. GET /api/settings/safety + PATCH /api/settings/safety
//     Read/write the global edge_case_rules split into hard + soft.
// ---------------------------------------------------------------------------
router.get('/settings/safety', ...authSuper, async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  // Global rules only (business_id IS NULL). Per-tenant rules would
  // also appear here, but the UI shows just the platform-level set.
  const { data, error } = await supabase
    .from('edge_case_rules')
    .select('rule_type, rule_text')
    .is('business_id', null)
    .order('rule_type', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const hard: string[] = [];
  const soft: string[] = [];
  for (const r of (data || []) as Array<{ rule_type: 'hard' | 'soft'; rule_text: string }>) {
    if (r.rule_type === 'hard') hard.push(r.rule_text);
    else if (r.rule_type === 'soft') soft.push(r.rule_text);
  }
  return res.json({ hard, soft });
});

router.patch('/settings/safety', ...authSuper, async (req: Request, res: Response) => {
  const body = req.body as { hard?: string[]; soft?: string[] };
  if (!body || !Array.isArray(body.hard) || !Array.isArray(body.soft)) {
    return res.status(400).json({ error: 'Expected { hard: string[], soft: string[] }' });
  }

  const supabase = getSupabase();
  // Replace: delete all global rules, then insert fresh ones
  // (preserves text but resets IDs — fine for MVP)
  const { error: delErr } = await supabase
    .from('edge_case_rules')
    .delete()
    .is('business_id', null);
  if (delErr) return res.status(500).json({ error: delErr.message });

  const rows: Array<{ business_id: null; rule_type: 'hard' | 'soft'; rule_text: string }> = [];
  for (const t of body.hard) rows.push({ business_id: null, rule_type: 'hard', rule_text: t });
  for (const t of body.soft) rows.push({ business_id: null, rule_type: 'soft', rule_text: t });

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('edge_case_rules').insert(rows);
    if (insErr) return res.status(500).json({ error: insErr.message });
  }
  return res.json({ hard: body.hard, soft: body.soft });
});

// ---------------------------------------------------------------------------
// (Onboarding status endpoint moved to ./onboarding.ts so it can be
// mounted at root `/` while this router stays at `/api`.)
// ---------------------------------------------------------------------------

export default router;
