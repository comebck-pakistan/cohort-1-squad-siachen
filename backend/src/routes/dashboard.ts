// ---------------------------------------------------------------------------
// Owner dashboard endpoints — 7 critical reads/writes the dashboard needs.
//
// All require JWT (requireAuth) and own-business check (requireOwnedBusiness).
// Every response uses ISO 8601 UTC timestamps. UI formats to Asia/Karachi.
//
// Endpoints:
//   GET    /api/business/:businessId/today
//   GET    /api/business/:businessId/bookings?date=YYYY-MM-DD
//   PATCH  /api/appointments/:id          (status | reschedule)
//   POST   /api/business/:businessId/staff
//   GET    /api/business/:businessId/staff               (Phase 1 dashboard wiring)
//   PATCH  /api/staff/:staffId/skills     (replace staff_skills with new set)
//   POST   /api/business/:businessId/services
//   GET    /api/business/:businessId/services            (Phase 1 dashboard wiring)
//   GET    /api/business/:businessId/conversations
//   GET    /api/conversations/:conversationId/messages   (Story 18)
//   PATCH  /api/business/:businessId/agent-active        (Story 13 — owner pause)
//   GET    /api/business/:businessId/agent-active        (Story 13 — owner read)
//   GET    /api/business/:businessId/escalations         (Phase 1 dashboard wiring)
//   POST   /api/escalations/:escalationId/resolve        (Wave 2 — owner marks done)
//   POST   /api/conversations/:conversationId/owner-reply (Wave 2 — owner manual send)
//   GET    /api/business/:businessId/resolved-escalations (Wave 2 — Resolved sub-tab)
//   GET    /api/business/:businessId/dashboard-stats     (Phase 1 dashboard wiring)
//   GET    /api/business/:businessId/ai-rules            (Phase 1 dashboard wiring)
//   PUT    /api/business/:businessId/ai-rules            (Phase 1 dashboard wiring)
//   GET    /api/business/:businessId/connection-info     (Phase 1: source of truth for transport choice)
//
// Auth: Authorization: Bearer <jwt from Supabase auth signup/login>.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import axios, { AxiosError, Method } from 'axios';
import { getSupabase } from '../lib/supabase';
import { requireAuth, requireOwnedBusiness } from '../lib/auth';
import {
  getMessageThread,
  saveMessage,
  touchConversation,
  updateConversationState,
} from '../lib/db';
import { childLogger } from '../lib/logger';

const router = Router();
const auth = [requireAuth] as const;
const owned = (param: string) => [requireAuth, requireOwnedBusiness(param)] as const;

// Bridge config — same values the onboarding proxy uses (see
// routes/onboarding.ts). Kept local rather than imported because the
// onboarding module wraps axios differently; both sides read the
// same env vars so the URLs always line up.
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3100';
const BRIDGE_TOKEN = process.env.BRIDGE_INTERNAL_TOKEN || '';
const log = childLogger('route.dashboard');

// ---------------------------------------------------------------------------
// 1. GET /api/business/:businessId/today
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/today',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const now = new Date();
    const startOfDayUTC = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0
    ));
    // Boundary for "today" expressed as PKT: Pakistan is UTC+5, so a PKT
    // day runs from 19:00 UTC of the previous calendar day to 18:59 UTC
    // of "today". We compute against PKT midnight for the owner.
    const pktNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const pktDayStart = new Date(Date.UTC(
      pktNow.getUTCFullYear(), pktNow.getUTCMonth(), pktNow.getUTCDate(), 0, 0, 0
    ));
    const pktDayStartUtc = new Date(pktDayStart.getTime() - 5 * 60 * 60 * 1000);
    const pktDayEndUtc = new Date(pktDayStartUtc.getTime() + 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, start_time, end_time, status, source,
        customer:customers(id, phone, name),
        service:services(id, name, price, duration_minutes),
        staff:staff(id, name)
      `)
      .eq('business_id', businessId)
      .gte('start_time', pktDayStartUtc.toISOString())
      .lt('start_time', pktDayEndUtc.toISOString())
      .order('start_time', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ appointments: data || [] });
  }
);

// ---------------------------------------------------------------------------
// 2. GET /api/business/:businessId/bookings?date=YYYY-MM-DD
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/bookings',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const date = (req.query.date as string) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date query param must be YYYY-MM-DD' });
    }

    const supabase = getSupabase();
    // PKT day boundaries
    const pktStart = new Date(`${date}T00:00:00+05:00`);
    const pktEnd = new Date(pktStart.getTime() + 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, start_time, end_time, status, source,
        customer:customers(id, phone, name),
        service:services(id, name, price, duration_minutes),
        staff:staff(id, name)
      `)
      .eq('business_id', businessId)
      .gte('start_time', pktStart.toISOString())
      .lt('start_time', pktEnd.toISOString())
      .order('start_time', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ date, appointments: data || [] });
  }
);

// ---------------------------------------------------------------------------
// 3. PATCH /api/appointments/:id
//    Body: { status?: 'pending'|'confirmed'|'completed'|'cancelled', start_time?: ISO }
//    Reschedule MUST pass through a re-check via createAppointment style
//    helper, but for MVP we trust the EXCLUSION constraint to reject.
// ---------------------------------------------------------------------------
router.patch(
  '/appointments/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    if (!req.user?.businessId) return res.status(403).json({ error: 'No business' });
    const { id } = req.params;
    const { status, start_time, end_time } = (req.body || {}) as {
      status?: string;
      start_time?: string;
      end_time?: string;
    };

    const validStatus = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (status && !validStatus.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatus.join(', ')}` });
    }

    const update: Record<string, string> = {};
    if (status) update.status = status;
    if (start_time) update.start_time = start_time;
    if (end_time) update.end_time = end_time;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const supabase = getSupabase();
    // First confirm this appointment belongs to user's business
    const { data: appt } = await supabase
      .from('appointments')
      .select('business_id')
      .eq('id', id)
      .maybeSingle();
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    if (appt.business_id !== req.user.businessId) {
      return res.status(403).json({ error: 'Not your appointment' });
    }

    const { data, error } = await supabase
      .from('appointments')
      .update(update)
      .eq('id', id)
      .select(`
        id, start_time, end_time, status, source,
        customer:customers(id, phone, name),
        service:services(id, name),
        staff:staff(id, name)
      `)
      .maybeSingle();

    if (error) {
      // 23P01 = overlapping appointment for the same staff
      if (error.code === '23P01') {
        return res.status(409).json({
          error: 'That staff member already has an overlapping appointment at the new time',
        });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.json({ appointment: data });
  }
);

// ---------------------------------------------------------------------------
// 4. POST /api/business/:businessId/staff
//    Body: { name, phone?, skill_service_ids: string[] }
// ---------------------------------------------------------------------------
router.post(
  '/business/:businessId/staff',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const { name, phone, skill_service_ids = [] } = (req.body || {}) as {
      name?: string;
      phone?: string;
      skill_service_ids?: string[];
    };
    if (!name) return res.status(400).json({ error: 'Missing name' });

    const supabase = getSupabase();
    const { data: staff, error } = await supabase
      .from('staff')
      .insert({ business_id: businessId, name, phone: phone || null, is_active: true })
      .select('id, name, phone, is_active, created_at')
      .single();
    if (error || !staff) {
      return res.status(500).json({ error: error?.message || 'Insert failed' });
    }

    // Add skills if provided
    if (skill_service_ids.length > 0) {
      const rows = skill_service_ids.map((sid) => ({
        staff_id: staff.id,
        service_id: sid,
      }));
      const { error: skillErr } = await supabase.from('staff_skills').insert(rows);
      if (skillErr) {
        return res.status(201).json({
          staff,
          warning: `Created but skills not saved: ${skillErr.message}`,
        });
      }
    }

    return res.status(201).json({ staff });
  }
);

// ---------------------------------------------------------------------------
// 5. PATCH /api/staff/:staffId/skills  — replace the staff's skill set
//    Body: { service_ids: string[] }
// ---------------------------------------------------------------------------
router.patch(
  '/staff/:staffId/skills',
  requireAuth,
  async (req: Request, res: Response) => {
    if (!req.user?.businessId) return res.status(403).json({ error: 'No business' });
    const { staffId } = req.params;
    const { service_ids = [] } = (req.body || {}) as { service_ids?: string[] };

    const supabase = getSupabase();
    // Verify this staff belongs to user's business
    const { data: stf } = await supabase
      .from('staff')
      .select('business_id')
      .eq('id', staffId)
      .maybeSingle();
    if (!stf) return res.status(404).json({ error: 'Staff not found' });
    if (stf.business_id !== req.user.businessId) {
      return res.status(403).json({ error: 'Not your staff' });
    }

    // Replace skills atomically: delete all, then insert new
    const { error: delErr } = await supabase
      .from('staff_skills')
      .delete()
      .eq('staff_id', staffId);
    if (delErr) return res.status(500).json({ error: delErr.message });

    if (service_ids.length > 0) {
      const rows = service_ids.map((sid) => ({
        staff_id: staffId,
        service_id: sid,
      }));
      const { error: insErr } = await supabase
        .from('staff_skills')
        .insert(rows);
      if (insErr) return res.status(500).json({ error: insErr.message });
    }

    const { data: skills } = await supabase
      .from('staff_skills')
      .select('service_id')
      .eq('staff_id', staffId);

    return res.json({
      staff_id: staffId,
      service_ids: (skills || []).map((s) => s.service_id),
    });
  }
);

// ---------------------------------------------------------------------------
// 6. POST /api/business/:businessId/services
//    Body: { name, duration_minutes, staff_required?, price?, category? }
//    category was added in 13_salon_portal_fields.sql — owner dashboard
//    surfaces a category pick ("Hair" / "Skin" / "Nails") for new
//    services so we persist it here.
// ---------------------------------------------------------------------------
router.post(
  '/business/:businessId/services',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const {
      name,
      duration_minutes,
      staff_required = 1,
      price,
      category,
    } = (req.body || {}) as {
      name?: string;
      duration_minutes?: number;
      staff_required?: number;
      price?: number;
      category?: string;
    };
    if (!name || !duration_minutes) {
      return res.status(400).json({ error: 'Missing name or duration_minutes' });
    }
    if (!Number.isInteger(duration_minutes) || duration_minutes < 5) {
      return res
        .status(400)
        .json({ error: 'duration_minutes must be a positive integer (min 5)' });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('services')
      .insert({
        business_id: businessId,
        name,
        duration_minutes,
        staff_required,
        price: price ?? null,
        category: category || null,
        is_active: true,
      })
      .select('id, name, duration_minutes, staff_required, price, category, is_active')
      .single();

    if (error || !data) {
      return res.status(500).json({ error: error?.message || 'Insert failed' });
    }
    return res.status(201).json({ service: data });
  }
);

// PATCH /api/business/:businessId/services/:serviceId
// Owner-edit flow for the Services Catalog tab. Body: partial —
// { name?, duration_minutes?, price?, category?, is_active? }.
// Validates duration_minutes if provided (positive integer, ≥5).
router.patch(
  '/business/:businessId/services/:serviceId',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId, serviceId } = req.params;
    const { name, duration_minutes, price, category, is_active } = (req.body || {}) as {
      name?: string;
      duration_minutes?: number;
      price?: number;
      category?: string | null;
      is_active?: boolean;
    };

    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from('services')
      .select('business_id')
      .eq('id', serviceId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Service not found' });
    if (existing.business_id !== businessId) {
      return res.status(403).json({ error: 'Not your service' });
    }

    const update: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      update.name = name.trim();
    }
    if (duration_minutes !== undefined) {
      if (!Number.isInteger(duration_minutes) || duration_minutes < 5) {
        return res.status(400).json({ error: 'duration_minutes must be a positive integer (min 5)' });
      }
      update.duration_minutes = duration_minutes;
    }
    if (price !== undefined) update.price = price;
    if (category !== undefined) update.category = category;
    if (is_active !== undefined) update.is_active = is_active;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('services')
      .update(update)
      .eq('id', serviceId)
      .select('id, name, duration_minutes, staff_required, price, category, is_active, created_at')
      .single();
    if (error || !data) return res.status(500).json({ error: error?.message || 'Update failed' });
    return res.json({ service: data });
  }
);

// PATCH /api/business/:businessId/staff/:staffId
// Owner-edit flow for the Staff Allocation tab. Body: partial —
// { name?, role?, working_days?, phone?, is_active? }.
// Editing a staff's *skills* is a separate flow (PATCH /staff/:id/skills)
// — that's the many-to-many table this route deliberately does not touch.
router.patch(
  '/business/:businessId/staff/:staffId',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId, staffId } = req.params;
    const { name, role, working_days, phone, is_active } = (req.body || {}) as {
      name?: string;
      role?: string | null;
      working_days?: string | null;
      phone?: string | null;
      is_active?: boolean;
    };

    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from('staff')
      .select('business_id')
      .eq('id', staffId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Staff not found' });
    if (existing.business_id !== businessId) {
      return res.status(403).json({ error: 'Not your staff' });
    }

    const update: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      update.name = name.trim();
    }
    if (role !== undefined) update.role = role;
    if (working_days !== undefined) update.working_days = working_days;
    if (phone !== undefined) update.phone = phone;
    if (is_active !== undefined) update.is_active = is_active;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('staff')
      .update(update)
      .eq('id', staffId)
      .select('id, name, phone, role, working_days, is_active, created_at')
      .single();
    if (error || !data) return res.status(500).json({ error: error?.message || 'Update failed' });
    return res.json({ staff: data });
  }
);

// ---------------------------------------------------------------------------
// 7. GET /api/business/:businessId/conversations
//    List recent ESCALATIONS — conversations that need human attention.
//    Per the 2026-08-07 redesign, the inbox tab only shows:
//      (a) conversations with an unresolved escalation_events row, OR
//      (b) conversations with status='human_takeover' (owner clicked
//          Take Over Chat without an explicit LLM escalation).
//    Resolved escalations disappear from this view; data is preserved
//    in escalation_events if we want a "history" view later.
//    Each row carries last message preview + the customer's next
//    upcoming appointment (single query, no N+1) — same shape as
//    before so the frontend doesn't need a separate type for "regular"
//    vs "escalation" conversations.
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/conversations',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const supabase = getSupabase();

    // Step A: collect the conversation ids we want to show. Two paths:
    //   1. Unresolved escalations (any reason — complaint, low_confidence,
    //      customer_request_human, or the LID needs_review flag from
    //      message-handler). resolved=false is the gate. Scoped via
    //      conversations!inner(business_id) because the service-role
    //      client bypasses RLS, so we have to filter manually to avoid
    //      leaking another salon's escalations to this owner.
    //   2. Manually taken-over conversations (no formal escalation but
    //      the owner clicked Take Over Chat). Already business-scoped.
    const [escRes, takeoverRes] = await Promise.all([
      supabase
        .from('escalation_events')
        .select('id, conversation_id, created_at, reason, conversations!inner(business_id)')
        .eq('resolved', false)
        .eq('conversations.business_id', businessId),
      supabase
        .from('conversations')
        .select('id')
        .eq('business_id', businessId)
        .eq('status', 'human_takeover'),
    ]);

    // Union the ids, dedup. If either query errors we treat that
    // source as empty rather than failing the whole endpoint — the
    // Escalations tab is decoration on top of the reply path.
    // Also capture the latest (most-recently-created) escalation id
    // + reason per conversation so the Mark Resolved button has a
    // target AND the UI can show the right badge ("Medical concern"
    // / "Complaint" / "Wants human" instead of just "Booking Request"
    // from the LLM's inferred intent). Since we only fetched
    // unresolved rows above, "latest" is just the most-recently-
    // created one per conversation in this set.
    const idSet = new Set<string>();
    const latestEscByConv = new Map<
      string,
      { id: string; created_at: string; reason: string | null }
    >();
    if (!escRes.error) {
      for (const e of escRes.data || []) {
        if (!e.conversation_id) continue;
        idSet.add(e.conversation_id);
        // The PostgREST SELECT shape for the joined row is loose;
        // grab the id off whatever field has it.
        const escId = (e as unknown as { id?: string }).id;
        const created = (e as unknown as { created_at?: string }).created_at;
        const reason = (e as unknown as { reason?: string }).reason ?? null;
        if (!escId || !created) continue;
        const existing = latestEscByConv.get(e.conversation_id);
        if (!existing || created > existing.created_at) {
          latestEscByConv.set(e.conversation_id, {
            id: escId,
            created_at: created,
            reason,
          });
        }
      }
    } else {
      console.warn(
        '[dashboard] escalation_events lookup failed:',
        escRes.error.message
      );
    }
    if (!takeoverRes.error) {
      for (const c of takeoverRes.data || []) {
        if (c.id) idSet.add(c.id);
      }
    } else {
      console.warn(
        '[dashboard] human_takeover conversations lookup failed:',
        takeoverRes.error.message
      );
    }

    // Nothing escalated, nothing taken over — return empty list
    // immediately. Avoids the second query entirely.
    if (idSet.size === 0) {
      return res.json({ conversations: [] });
    }

    const wantedIds = Array.from(idSet);

    const { data, error } = await supabase
      .from('conversations')
      .select(`
        id, status, last_message_at, created_at,
        customer:customers(id, phone, name),
        state:conversation_state(
          current_intent, last_customer_msg, last_agent_msg, outcome
        )
      `)
      .eq('business_id', businessId)
      .in('id', wantedIds)
      .order('last_message_at', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });

    // Pull "next upcoming appointment per customer" in a single query so
    // we don't N+1 the conversations list. Only future, non-cancelled
    // appointments count.
    const customerIds = (data || [])
      .map((c) => (Array.isArray(c.customer) ? c.customer[0]?.id : c.customer?.id))
      .filter((x): x is string => Boolean(x));
    let nextByCustomer = new Map<
      string,
      { id: string; start_time: string; end_time: string; status: string; service_name: string | null; staff_name: string | null }
    >();
    if (customerIds.length > 0) {
      const { data: appts } = await supabase
        .from('appointments')
        .select(`
          id, customer_id, start_time, end_time, status,
          service:services(name),
          staff:staff(name)
        `)
        .eq('business_id', businessId)
        .in('customer_id', customerIds)
        .in('status', ['pending', 'confirmed'])
        .gt('start_time', new Date().toISOString())
        .order('start_time', { ascending: true });
      for (const a of appts || []) {
        if (nextByCustomer.has(a.customer_id)) continue; // first wins = soonest
        nextByCustomer.set(a.customer_id, {
          id: a.id,
          start_time: a.start_time,
          end_time: a.end_time,
          status: a.status,
          service_name: (Array.isArray(a.service) ? a.service[0]?.name : a.service?.name) ?? null,
          staff_name: (Array.isArray(a.staff) ? a.staff[0]?.name : a.staff?.name) ?? null,
        });
      }
    }

    const decorated = (data || []).map((c) => {
      // Supabase joins can resolve as object OR as a one-element array.
      const custRecord = Array.isArray(c.customer) ? c.customer[0] : c.customer;
      const custId = custRecord?.id;
      const esc = latestEscByConv.get(c.id);
      return {
        ...c,
        next_appointment: custId ? nextByCustomer.get(custId) || null : null,
        // Surface the latest unresolved escalation id so the
        // frontend's "Mark Resolved" button has a target. null for
        // conversations in the queue purely via human_takeover.
        latest_escalation_id: esc?.id ?? null,
        // Surface the latest escalation REASON so the frontend can
        // render the right badge label ("Medical concern" / "Complaint"
        // / "Wants human") instead of relying on the LLM's
        // conversation_state.current_intent, which is usually 'book'
        // and would always render as "Booking Request" — wrong for
        // safety/compliance escalations. null for human_takeover-only
        // conversations.
        latest_escalation_reason: esc?.reason ?? null,
      };
    });

    return res.json({ conversations: decorated });
  }
);

// ---------------------------------------------------------------------------
// 7a-bis. GET /api/business/:businessId/resolved-escalations
//
// Resolved sub-tab inside the Escalations view. Returns the rows
// whose LATEST escalation_event is resolved=true, ordered by
// resolved_at desc (most recently resolved first).
//
// Same row shape as /conversations (so the frontend renderer is
// identical), plus a `resolved_at` field for the row's "Resolved
// 3h ago" label.
//
// Implementation note: we query the LATEST escalation row per
// conversation via a window function (DISTINCT ON in Postgres lingo)
// so we don't double-count a conversation that was resolved, then
// re-escalated, then resolved again.
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/resolved-escalations',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const supabase = getSupabase();

    // Step 1: find the conversation_ids whose latest escalation is
    // resolved=true. We grab all escalations for this business,
    // then pick the latest per conversation in JS (cheaper than
    // wiring a separate view). Resulting size is bounded by the
    // escalations per business, which is the same order of magnitude
    // as the active list.
    const { data: allEsc, error: escErr } = await supabase
      .from('escalation_events')
      .select(
        'id, conversation_id, resolved, resolved_at, created_at, conversations!inner(business_id)'
      )
      .eq('conversations.business_id', businessId);

    if (escErr) {
      return res.status(500).json({ error: escErr.message });
    }

    // Pick the latest escalation per conversation_id. Only include
    // a conversation if that latest is resolved=true.
    const latestByConv = new Map<
      string,
      { id: string; resolved: boolean; resolved_at: string | null; created_at: string }
    >();
    for (const e of allEsc || []) {
      const existing = latestByConv.get(e.conversation_id);
      const created = e.created_at;
      if (!existing || created > existing.created_at) {
        latestByConv.set(e.conversation_id, {
          id: e.id,
          resolved: e.resolved,
          resolved_at: e.resolved_at,
          created_at: created,
        });
      }
    }
    const resolvedConvIds: string[] = [];
    const resolvedAtByConv = new Map<string, string | null>();
    const escalationIdByConv = new Map<string, string>();
    for (const [convId, latest] of latestByConv) {
      if (latest.resolved) {
        resolvedConvIds.push(convId);
        resolvedAtByConv.set(convId, latest.resolved_at);
        escalationIdByConv.set(convId, latest.id);
      }
    }

    if (resolvedConvIds.length === 0) {
      return res.json({ conversations: [] });
    }

    // Step 2: load the conversation rows + customer + state in one query.
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        id, status, last_message_at, created_at,
        customer:customers(id, phone, name),
        state:conversation_state(
          current_intent, last_customer_msg, last_agent_msg, outcome
        )
      `)
      .eq('business_id', businessId)
      .in('id', resolvedConvIds)
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });

    // Step 3: decorate with resolved_at + escalation_id, sort by
    // resolved_at desc, apply limit.
    const decorated = (data || [])
      .map((c) => ({
        ...c,
        resolved_at: resolvedAtByConv.get(c.id) ?? null,
        // Carry the escalation id so the frontend can re-resolve if
        // needed (it's already resolved, but defensive).
        latest_escalation_id: escalationIdByConv.get(c.id) ?? null,
        next_appointment: null as unknown, // skip the heavy join — history view doesn't need it
      }))
      .sort((a, b) => {
        const at = a.resolved_at ? Date.parse(a.resolved_at) : 0;
        const bt = b.resolved_at ? Date.parse(b.resolved_at) : 0;
        return bt - at;
      })
      .slice(0, limit);

    return res.json({ conversations: decorated });
  }
);

// ---------------------------------------------------------------------------
// 7b. POST /api/escalations/:escalationId/resolve
//
// Owner clicks "Mark Resolved" on an escalation in the Escalations
// tab. Flips escalation_events.resolved=true with resolved_at=now()
// and resolved_by=auth.uid(). The row is left in place so the
// "Resolved" sub-tab can still show it (history view) — the
// /conversations list endpoint only returns rows where
// resolved=false, so flipping this immediately drops the row from
// the Active sub-tab.
//
// Idempotent: re-resolving an already-resolved row is a no-op
// (returns 200 with the existing row). Returns 404 if the escalation
// doesn't exist OR doesn't belong to this owner's business (we don't
// distinguish — leaking "exists but not yours" would be an info
// disclosure).
//
// Superadmin can resolve any escalation.
// ---------------------------------------------------------------------------
router.post(
  '/escalations/:escalationId/resolve',
  requireAuth,
  async (req: Request, res: Response) => {
    const { escalationId } = req.params;
    const user = req.user!;
    const supabase = getSupabase();

    // Load the escalation joined to its conversation so we can
    // enforce business ownership in one round-trip. .maybeSingle()
    // gives null for either "doesn't exist" or "exists but wrong
    // business" — we collapse to a single 404 to avoid info
    // disclosure.
    const { data: esc, error: escErr } = await supabase
      .from('escalation_events')
      .select('id, resolved, conversation_id, conversations!inner(business_id)')
      .eq('id', escalationId)
      .maybeSingle();

    if (escErr) {
      return res.status(500).json({ error: escErr.message });
    }
    if (!esc) {
      return res.status(404).json({ error: 'Escalation not found' });
    }

    const businessId = (esc as unknown as {
      conversations: { business_id: string };
    }).conversations.business_id;

    if (!user.isSuperadmin && user.businessId !== businessId) {
      // Don't leak that the row exists — same 404 as above.
      return res.status(404).json({ error: 'Escalation not found' });
    }

    // Idempotent — if already resolved, just return the row.
    if (esc.resolved) {
      return res.json({
        id: esc.id,
        resolved: true,
        alreadyResolved: true,
      });
    }

    // resolved_by references profiles(id). The superadmin token
    // synthesizes a fake id ('superadmin-secret') which is NOT a
    // real profile row, so we leave resolved_by null for them rather
    // than violate the FK.
    const resolvedByPatch = user.isSuperadmin ? null : user.id;
    const { data: updated, error: updErr } = await supabase
      .from('escalation_events')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedByPatch,
      })
      .eq('id', escalationId)
      .select('id, resolved, resolved_at, resolved_by')
      .maybeSingle();

    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }
    if (!updated) {
      return res.status(500).json({ error: 'Resolve did not apply' });
    }

    return res.json({ ...updated, alreadyResolved: false });
  }
);

// ---------------------------------------------------------------------------
// 7c. POST /api/conversations/:conversationId/owner-reply
//
// Owner hits Send in the Take Over Chat textarea. Persists the
// owner turn to `messages` first (so the UI thread refreshes
// immediately), then proxies the actual WhatsApp send to the bridge
// service. The bridge is the only process that owns the live
// WhatsAppWebClient instance — the backend is transport-agnostic.
//
// We always persist before send. If the bridge send fails, the
// owner message row is still in `messages` (with the failed send
// visible in bridge logs); the owner can re-send. We'd rather
// double-log than drop a message the owner actually typed.
//
// Body: { text: string }
// Returns:
//   200 { ok: true, messageId, sentToBridge: boolean, error?: string }
//   400 missing/empty text
//   403 not your conversation
//   404 conversation doesn't exist
//   502 bridge is down
//   500 unexpected error
// ---------------------------------------------------------------------------
router.post(
  '/conversations/:conversationId/owner-reply',
  requireAuth,
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const user = req.user!;
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const supabase = getSupabase();

    // Load conversation + customer phone + businessId. .maybeSingle()
    // so we can return a clean 404 for both "doesn't exist" and
    // "exists but not yours".
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select(
        'id, business_id, customer_id, customers!inner(phone, wa_chat_id)'
      )
      .eq('id', conversationId)
      .maybeSingle();

    if (convErr) {
      return res.status(500).json({ error: convErr.message });
    }
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const custRecord = Array.isArray(conv.customers)
      ? conv.customers[0]
      : conv.customers;
    const customerPhone: string | null = custRecord?.phone ?? null;
    const customerChatId: string | null = custRecord?.wa_chat_id ?? null;

    if (!user.isSuperadmin && user.businessId !== conv.business_id) {
      return res.status(403).json({ error: 'Not your conversation' });
    }
    if (!customerPhone && !customerChatId) {
      return res.status(422).json({
        error: 'Conversation has no resolvable customer identifier',
      });
    }

    // Persist the owner message first. We use saveMessage which is
    // best-effort; on failure we still attempt the bridge send so a
    // DB hiccup doesn't silently lose the customer's received text.
    let messageId: string | null = null;
    try {
      const { data: msgRow, error: msgErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'owner',
          content: text,
        })
        .select('id')
        .maybeSingle();
      if (msgErr) {
        log.warn(
          { conversationId, err: msgErr.message },
          'owner-reply: messages insert failed (non-fatal — still attempting send)'
        );
      } else if (msgRow?.id) {
        messageId = msgRow.id;
      }
    } catch (e) {
      log.warn(
        { conversationId, err: (e as Error).message },
        'owner-reply: messages insert threw (non-fatal)'
      );
    }

    // Best-effort: bump conversation_state + last_message_at so the
    // row sorts correctly and the next LLM turn sees the owner reply
    // in the context (if the customer replies next).
    try {
      await updateConversationState(conversationId, {
        last_agent_msg: text,
      });
      await touchConversation(conversationId);
    } catch (e) {
      log.warn(
        { conversationId, err: (e as Error).message },
        'owner-reply: state/touch failed (non-fatal)'
      );
    }

    // Resolve the chatId the bridge will hand to client.sendMessage.
    //
    // Priority order:
    //   1. customers.wa_chat_id — the raw identifier whatsapp-web.js
    //      handed us on the customer's last inbound message. This
    //      is the ONLY way to handle LID-format customers
    //      ("966541183544-1454589702") correctly; constructing
    //      `${phone}@c.us` from the normalized digits would have
    //      WhatsApp reject with "No LID for user".
    //   2. customers.phone if it already contains '@' — some
    //      legacy rows were stored with the full chat id rather
    //      than normalized digits.
    //   3. `${phone}@c.us` — fallback for customers whose
    //      wa_chat_id is still NULL (i.e. they've never sent a
    //      message since the wa_chat_id migration). They'll
    //      backfill on their next inbound message.
    //
    // See upsertCustomerChatId() in db.ts and the migration at
    // database/migrations/2026_08_07_add_customers_wa_chat_id.sql.
    let chatId: string;
    if (customerChatId && customerChatId.trim().length > 0) {
      // Priority 1: explicit wa_chat_id from a recent inbound
      // message. Captured by upsertCustomerChatId() in db.ts.
      chatId = customerChatId.trim();
    } else if (customerPhone && customerPhone.includes('@')) {
      // Priority 2: phone already contains "@" — stored as a full
      // chat id (e.g. "923001234567@c.us"). Some legacy rows.
      chatId = customerPhone;
    } else if (customerPhone && customerPhone.includes('-')) {
      // Priority 3: phone contains a dash — it's already in
      // whatsapp-web.js LID format ("966541183544-1454780892").
      // Use as-is, do NOT append @c.us. Appending @c.us produces a
      // malformed id that WhatsApp rejects with "No LID for user".
      //
      // This case fires for customers whose original inbound
      // identifier was LID-format AND who haven't sent a new
      // message since the wa_chat_id migration ran (so wa_chat_id
      // is still NULL but phone was originally stored verbatim).
      chatId = customerPhone;
    } else if (customerPhone) {
      // Priority 4: normalized digits — construct the standard
      // <digits>@c.us chat id.
      chatId = `${customerPhone}@c.us`;
    } else {
      // Shouldn't reach here — the 422 guard above catches
      // !customerPhone && !customerChatId. Defensive fallback.
      chatId = '';
    }

    // Proxy the actual send to the bridge. The bridge's
    // /onboarding/:businessId/send endpoint requires X-Bridge-Token;
    // we forward it. If BRIDGE_URL is not configured, surface a
    // clear 503 so the frontend can show "send unavailable".
    if (!BRIDGE_TOKEN || !BRIDGE_URL) {
      log.warn(
        { conversationId, businessId: conv.business_id },
        'owner-reply: bridge not configured (BRIDGE_URL / BRIDGE_INTERNAL_TOKEN missing)'
      );
      return res.status(503).json({
        error: 'bridge service not configured',
        sentToBridge: false,
        messageId,
      });
    }

    try {
      const response = await axios({
        method: 'post' as Method,
        url: `${BRIDGE_URL}/onboarding/${conv.business_id}/send`,
        headers: {
          'X-Bridge-Token': BRIDGE_TOKEN,
          'Content-Type': 'application/json',
        },
        data: { to: chatId, text },
        validateStatus: () => true,
        timeout: 10_000,
      });

      if (response.status >= 200 && response.status < 300) {
        log.info(
          { conversationId, businessId: conv.business_id, to: chatId, textLength: text.length },
          'owner-reply delivered via bridge'
        );
        return res.json({ ok: true, sentToBridge: true, messageId });
      }

      // Bridge returned non-2xx — surface it to the caller. We treat
      // 404 (no active session) and 5xx as a real delivery failure.
      log.error(
        { conversationId, status: response.status, body: response.data },
        'owner-reply: bridge send failed'
      );
      return res.status(502).json({
        error: `bridge send failed: ${response.status}`,
        bridgeStatus: response.status,
        bridgeBody: response.data,
        sentToBridge: false,
        messageId,
      });
    } catch (e) {
      const err = e as AxiosError;
      log.error(
        { conversationId, err: err.message },
        'owner-reply: bridge unreachable'
      );
      return res.status(502).json({
        error: `bridge unreachable: ${err.message}`,
        sentToBridge: false,
        messageId,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// 4b. GET /api/conversations/:conversationId/messages
//
// Story 18 — owner-facing inbox conversation thread. Returns every
// customer/agent turn in chronological order. Requires:
//   - requireAuth (Bearer JWT or superadmin token)
//   - conversationId exists
//   - caller's businessId owns that conversation
//   - superadmin can read any conversation
//
// RLS on messages is the second line of defense, but we resolve and
// gate explicitly here so a bad token gets 401/403 (not the generic
// 403/empty rows RLS would return).
// ---------------------------------------------------------------------------
router.get(
  '/conversations/:conversationId/messages',
  requireAuth,
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    if (!conversationId) {
      return res.status(400).json({ error: 'Missing conversationId' });
    }
    const limit = Math.min(parseInt((req.query.limit as string) || '500', 10), 1000);

    const supabase = getSupabase();
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, business_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (convErr) {
      return res.status(500).json({ error: convErr.message });
    }
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Ownership gate. Superadmin bypasses the business check.
    if (!req.user!.isSuperadmin && req.user!.businessId !== conv.business_id) {
      return res.status(403).json({ error: 'You do not own this conversation' });
    }

    const messages = await getMessageThread(conversationId, limit);
    return res.json({
      conversationId,
      messages: messages.map((m) => ({
        id: m.id,
        sender_type: m.sender_type,
        content: m.content,
        created_at: m.created_at,
      })),
    });
  }
);

// ---------------------------------------------------------------------------
// 4c. PATCH /api/business/:businessId/agent-active  (Story 13)
//
// Owner-side kill switch. Flips businesses.agent_active. When false,
// handleIncomingMessage() short-circuits BEFORE calling the LLM —
// customer messages are still persisted to `messages` so the owner
// can read them in the inbox, but the bot never replies.
//
// Suspended billing_state is a hard guard: a paused-for-non-payment
// tenant cannot self-pause-then-resume to dodge suspension. The
// superadmin can still flip them back on after payment clears.
//
// Owner-only — distinct from the superadmin endpoint at
// /api/superadmin/salons/:id/agent-active so the audit trail is
// clear about who flipped the switch.
// ---------------------------------------------------------------------------
router.patch(
  '/business/:businessId/agent-active',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const { agent_active } = (req.body || {}) as { agent_active?: boolean };
    if (typeof agent_active !== 'boolean') {
      return res.status(400).json({ error: 'agent_active must be a boolean' });
    }

    const supabase = getSupabase();

    // Guard: suspended tenants cannot flip agent_active back on.
    // Read billing_state + current agent_active in one query.
    const { data: biz, error: bizErr } = await supabase
      .from('businesses')
      .select('agent_active, billing_state')
      .eq('id', businessId)
      .maybeSingle();

    if (bizErr) {
      return res.status(500).json({ error: bizErr.message });
    }
    if (!biz) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (agent_active === true && biz.billing_state === 'suspended') {
      return res.status(403).json({
        error: 'Cannot reactivate AI while billing is suspended — clear payment first.',
      });
    }

    const { data: updated, error: updErr } = await supabase
      .from('businesses')
      .update({ agent_active })
      .eq('id', businessId)
      .select('id, agent_active')
      .maybeSingle();

    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }
    if (!updated) {
      return res.status(404).json({ error: 'Business not found after update' });
    }

    console.log(
      `[dashboard.ts] Story 13 — business ${businessId} agent_active: ${biz.agent_active} → ${agent_active} (flipped by owner)`,
    );
    return res.json({ id: updated.id, agent_active: updated.agent_active });
  }
);

// GET /api/business/:businessId/agent-active — Story 13 companion read.
// Used by the salon-portal toggle to render its initial state. Cheap
// single-row SELECT; RLS-gated.
router.get(
  '/business/:businessId/agent-active',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const { data, error } = await getSupabase()
      .from('businesses')
      .select('id, agent_active')
      .eq('id', businessId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Business not found' });
    return res.json({ id: data.id, agent_active: data.agent_active !== false });
  }
);

// ---------------------------------------------------------------------------
// Bonus helper endpoints (used by UI for dropdowns / pickers)
// ---------------------------------------------------------------------------

// GET /api/business/:businessId/services — list all services
router.get(
  '/business/:businessId/services',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_minutes, staff_required, price, is_active')
      .eq('business_id', businessId)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ services: data || [] });
  }
);

// GET /api/business/:businessId/staff — list all staff with skill IDs
router.get(
  '/business/:businessId/staff',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, phone, is_active, created_at')
      .eq('business_id', businessId)
      .order('name');

    const { data: skills } = await supabase
      .from('staff_skills')
      .select('staff_id, service_id, staff!inner(business_id)')
      .eq('staff.business_id', businessId);

    const skillMap = new Map<string, string[]>();
    for (const sk of (skills || []) as unknown as Array<{
      staff_id: string;
      service_id: string;
    }>) {
      const arr = skillMap.get(sk.staff_id) || [];
      arr.push(sk.service_id);
      skillMap.set(sk.staff_id, arr);
    }

    const staffWithSkills = (staff || []).map((s) => ({
      ...s,
      service_ids: skillMap.get(s.id) || [],
    }));
    return res.json({ staff: staffWithSkills });
  }
);

// ---------------------------------------------------------------------------
// 8. GET /api/business/:businessId/connection-info
//
// Phase 1 — source of truth for which transport a salon uses. The frontend
// calls this from /salon-portal/onboarding to decide whether to show the
// QR pairing page (web transport) or the Meta Cloud instructions
// (phone_number_id registered).
//
// Returns:
//   {
//     businessId,
//     phone_number_id_set,    // true → Meta Cloud transport
//     qr_pairing_available,   // true → /onboarding/:id QR flow
//     agent_active,           // true → already connected
//     instructions,           // server-rendered default copy
//     next_step               // 'inbox' | 'meta_cloud_setup' | 'scan_qr'
//   }
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/connection-info',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data: biz, error } = await supabase
      .from('businesses')
      .select('id, phone_number_id, agent_active')
      .eq('id', businessId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!biz) {
      return res.status(404).json({ error: 'business not found' });
    }

    const phone_number_id_set = !!biz.phone_number_id;
    const qr_pairing_available = !phone_number_id_set;
    const agent_active = !!biz.agent_active;

    const instructions = phone_number_id_set
      ? 'Your salon uses Meta Cloud API. Inbound WhatsApp messages arrive via Meta — no QR pairing needed.'
      : 'Scan the QR code with your salon WhatsApp to start receiving customer messages.';

    const next_step = agent_active
      ? 'inbox'
      : phone_number_id_set
        ? 'meta_cloud_setup'
        : 'scan_qr';

    return res.json({
      businessId,
      phone_number_id_set,
      qr_pairing_available,
      agent_active,
      instructions,
      next_step,
    });
  }
);

// ---------------------------------------------------------------------------
// 9. GET /api/business/:businessId/staff
//
// Lists all staff for the business, joined with their skill service_ids
// (the frontend renders a chip per skill on the Services & Staff tab).
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/staff',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data: rows, error } = await supabase
      .from('staff')
      .select('id, name, phone, role, working_days, is_active, created_at')
      .eq('business_id', businessId)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });

    // Fetch all skills for this business in one go.
    const { data: skillRows } = await supabase
      .from('staff_skills')
      .select('staff_id, service_id, services!inner(business_id)')
      .eq('services.business_id', businessId);

    const skillMap = new Map<string, string[]>();
    for (const s of (skillRows || []) as Array<{
      staff_id: string;
      service_id: string;
    }>) {
      const arr = skillMap.get(s.staff_id) || [];
      arr.push(s.service_id);
      skillMap.set(s.staff_id, arr);
    }

    const staff = (rows || []).map((s) => ({
      ...s,
      service_ids: skillMap.get(s.id) || [],
    }));
    return res.json({ staff });
  }
);

// ---------------------------------------------------------------------------
// 10. GET /api/business/:businessId/services
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/services',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('services')
      .select('id, name, price, duration_minutes, category, created_at')
      .eq('business_id', businessId)
      .order('category', { nullsFirst: false })
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ services: data || [] });
  }
);

// ---------------------------------------------------------------------------
// 11. GET /api/business/:businessId/dashboard-stats
//
// Powers the Overview tab. Returns:
//   - kpis:               bookings handled by AI, conversations, resolution rate, revenue
//   - hourly:             today's message volume bucketed by hour (PKT-friendly)
//   - intents:            distribution of customer intents (currently empty —
//                         would require LLM tagging on each inbound message)
//   - feed:               last 10 inbound/outbound messages across all conversations
//
// KPIs use a rolling "this month" window — same logic the KPI mocks used.
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/dashboard-stats',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    // Start of this calendar month, UTC.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [aiBookings, totalBookings, conversations, completedAppts] =
      await Promise.all([
        supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('source', 'whatsapp_bot')
          .gte('created_at', monthStart.toISOString()),
        supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .gte('created_at', monthStart.toISOString()),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .gte('last_message_at', monthStart.toISOString()),
        supabase
          .from('appointments')
          .select('services(price)')
          .eq('business_id', businessId)
          .eq('status', 'completed')
          .gte('created_at', monthStart.toISOString()),
      ]);

    const aiCount = aiBookings.count || 0;
    const totalCount = totalBookings.count || 0;
    const revenue = ((completedAppts.data || []) as unknown as Array<{
      services: { price: number } | null;
    }>).reduce(
      (sum, a) => sum + (a.services?.price || 0),
      0
    );

    // Today's message volume bucketed by UTC hour, returned as 12 buckets
    // (8a → 8p) for the chart.
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: todayMessages } = await supabase
      .from('messages')
      .select('created_at, conversations!inner(business_id)')
      .eq('conversations.business_id', businessId)
      .gte('created_at', dayStart.toISOString());

    const buckets = [8, 10, 12, 14, 16, 18, 20, 22, 0, 2, 4, 6];
    const hourly = buckets.map((h) => ({
      h: `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 || h === 24 ? 'a' : 'p'}`,
      c: 0,
    }));
    for (const m of (todayMessages || []) as Array<{ created_at: string }>) {
      const hour = new Date(m.created_at).getUTCHours();
      const idx = buckets.indexOf(hour);
      if (idx >= 0) hourly[idx].c++;
    }

    // Last 10 messages for the activity feed.
    const { data: recentMsgs } = await supabase
      .from('messages')
      .select(
        'id, content, sender_type, created_at, conversations!inner(customer_id, customers(name, phone))'
      )
      .eq('conversations.business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(10);

    const feed = ((recentMsgs || []) as unknown as Array<{
      content: string;
      sender_type: string;
      created_at: string;
      conversations: {
        customers: { name: string | null; phone: string } | null;
      };
    }>).map((m) => {
      const cust = m.conversations?.customers;
      const who = cust?.name || cust?.phone || 'customer';
      const verb =
        m.sender_type === 'ai'
          ? 'Recepta replied to'
          : m.sender_type === 'customer'
            ? `Message from ${who}`
            : 'Note';
      const snippet =
        m.content.length > 80 ? `${m.content.slice(0, 77)}...` : m.content;
      return {
        text: `${verb}: ${snippet}`,
        tone:
          m.sender_type === 'ai'
            ? 'success'
            : m.sender_type === 'customer'
              ? 'muted'
              : 'warn',
        time: new Date(m.created_at).toISOString(),
      };
    });

    return res.json({
      kpis: {
        bookings_handled: aiCount,
        conversations_processed: conversations.count || 0,
        resolution_rate: totalCount > 0 ? Math.round((aiCount / totalCount) * 100) : 0,
        revenue_pkr: revenue,
      },
      hourly,
      intents: [], // requires intent-tagging on inbound messages
      feed,
    });
  }
);

// ---------------------------------------------------------------------------
// 12. GET /api/business/:businessId/escalations
//
// Powers the Edge Cases tab. Joins escalation_events with conversations
// (to scope to this business) and customers (for display name + phone).
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/escalations',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('escalation_events')
      .select(
        'id, reason, ai_draft_response, resolved, resolved_at, created_at, triggered_rule_id, conversations!inner(id, business_id, customers(name, phone)), edge_case_rules(label, kind)'
      )
      .eq('conversations.business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });

    const escalations = ((data || []) as unknown as Array<{
      id: string;
      reason: string;
      ai_draft_response: string | null;
      resolved: boolean;
      resolved_at: string | null;
      created_at: string;
      triggered_rule_id: string | null;
      conversations: {
        id: string;
        customers: { name: string | null; phone: string } | null;
      };
      edge_case_rules: { label: string; kind: string } | null;
    }>).map((e) => ({
      id: e.id,
      conversation_id: e.conversations.id,
      customer_name: e.conversations.customers?.name || 'Unknown',
      customer_phone: e.conversations.customers?.phone || '',
      reason: e.reason,
      rule_label: e.edge_case_rules?.label || e.reason,
      rule_kind: e.edge_case_rules?.kind || 'soft',
      ai_draft: e.ai_draft_response,
      resolved: e.resolved,
      resolved_at: e.resolved_at,
      created_at: e.created_at,
    }));
    return res.json({ escalations });
  }
);

// ---------------------------------------------------------------------------
// 13. GET /api/business/:businessId/ai-rules
// 14. PUT /api/business/:businessId/ai-rules
//
// Owner-customized AI agent rules (TenantAIRules.tsx). Stored as JSONB
// on the businesses row (see database/schema/14_business_ai_rules.sql).
// Returns sensible defaults when the column is NULL so the UI never
// sits empty for a fresh signup.
// ---------------------------------------------------------------------------
const DEFAULT_AI_RULES = {
  rules: [] as string[],
  triggers: { discounts: true, late: true, custom: true },
  discountMode: 'promo' as 'decline' | 'promo',
  latePolicy:
    'If a customer is more than 15 minutes late, offer to reschedule or hold the slot for 5 more minutes.',
};

router.get(
  '/business/:businessId/ai-rules',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('businesses')
      .select('ai_rules')
      .eq('id', businessId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });

    const stored = (data?.ai_rules as Partial<typeof DEFAULT_AI_RULES>) || {};
    const merged = {
      rules: Array.isArray(stored.rules) ? stored.rules : DEFAULT_AI_RULES.rules,
      triggers: {
        discounts:
          typeof stored.triggers?.discounts === 'boolean'
            ? stored.triggers.discounts
            : DEFAULT_AI_RULES.triggers.discounts,
        late:
          typeof stored.triggers?.late === 'boolean'
            ? stored.triggers.late
            : DEFAULT_AI_RULES.triggers.late,
        custom:
          typeof stored.triggers?.custom === 'boolean'
            ? stored.triggers.custom
            : DEFAULT_AI_RULES.triggers.custom,
      },
      discountMode:
        stored.discountMode === 'decline' || stored.discountMode === 'promo'
          ? stored.discountMode
          : DEFAULT_AI_RULES.discountMode,
      latePolicy:
        typeof stored.latePolicy === 'string' && stored.latePolicy.length > 0
          ? stored.latePolicy
          : DEFAULT_AI_RULES.latePolicy,
    };
    return res.json(merged);
  }
);

router.put(
  '/business/:businessId/ai-rules',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const body = (req.body || {}) as Partial<typeof DEFAULT_AI_RULES>;

    const payload = {
      rules: Array.isArray(body.rules) ? body.rules.slice(0, 50) : [],
      triggers: {
        discounts: !!body.triggers?.discounts,
        late: !!body.triggers?.late,
        custom: !!body.triggers?.custom,
      },
      discountMode:
        body.discountMode === 'decline' || body.discountMode === 'promo'
          ? body.discountMode
          : 'promo',
      latePolicy:
        typeof body.latePolicy === 'string'
          ? body.latePolicy.slice(0, 1000)
          : DEFAULT_AI_RULES.latePolicy,
    };

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('businesses')
      .update({ ai_rules: payload })
      .eq('id', businessId)
      .select('ai_rules')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data?.ai_rules || payload);
  }
);

// ---------------------------------------------------------------------------
// 15. GET /api/business/:businessId/hours
// 16. PUT /api/business/:businessId/hours
//
// Owner-editable weekly schedule. The 7 rows live in business_hours with
// a UNIQUE(business_id, day_of_week) constraint, so PUT uses an
// UPSERT-per-row to handle "owner changed Monday but kept Tuesday" — no
// DELETE-then-INSERT, no race window where the table is empty.
//
// Day codes match the existing seed convention:
//   'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
// (Short codes — see 08_fabs_salon_seed.sql and db.ts:842.)
//
// Buffer between appointments is currently UI-only (no DB column).
// If we ever persist it, add a buffer_minutes integer to businesses.
// ---------------------------------------------------------------------------

const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

router.get(
  '/business/:businessId/hours',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('business_hours')
      .select('day_of_week, is_open, open_time, close_time')
      .eq('business_id', businessId)
      .order('day_of_week');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ hours: data || [] });
  }
);

router.put(
  '/business/:businessId/hours',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const { hours } = (req.body || {}) as {
      hours?: Array<{
        day_of_week: string;
        is_open: boolean;
        open_time: string | null;
        close_time: string | null;
      }>;
    };

    if (!Array.isArray(hours) || hours.length !== 7) {
      return res.status(400).json({
        error: 'hours must be an array of exactly 7 rows (one per day_of_week)',
      });
    }

    for (const h of hours) {
      if (!VALID_DAYS.includes(h.day_of_week as typeof VALID_DAYS[number])) {
        return res.status(400).json({
          error: `Invalid day_of_week: ${h.day_of_week}. Must be one of: ${VALID_DAYS.join(', ')}`,
        });
      }
      if (h.is_open) {
        if (!h.open_time || !h.close_time) {
          return res.status(400).json({
            error: `When is_open=true, open_time and close_time are required (day: ${h.day_of_week})`,
          });
        }
        if (
          !/^\d{2}:\d{2}(:\d{2})?$/.test(h.open_time) ||
          !/^\d{2}:\d{2}(:\d{2})?$/.test(h.close_time)
        ) {
          return res.status(400).json({
            error: `Times must be HH:MM or HH:MM:SS (day: ${h.day_of_week})`,
          });
        }
      }
    }

    const supabase = getSupabase();
    const rows = hours.map((h) => ({
      business_id: businessId,
      day_of_week: h.day_of_week,
      is_open: h.is_open,
      open_time: h.is_open ? h.open_time : null,
      close_time: h.is_open ? h.close_time : null,
    }));

    const { data, error } = await supabase
      .from('business_hours')
      .upsert(rows, { onConflict: 'business_id,day_of_week' })
      .select('day_of_week, is_open, open_time, close_time');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ hours: data || [] });
  }
);

// ---------------------------------------------------------------------------
// 17. GET    /api/business/:businessId/holidays
// 18. POST   /api/business/:businessId/holidays
// 19. DELETE /api/business/:businessId/holidays/:holidayId
//
// Owner-editable closures / blackout dates. The `holidays` table has a
// `reason` enum (public_holiday / event / maintenance / emergency /
// other) AND a free-text `note`. The UI captures only the note
// ("Independence Day", "Eid holiday", etc.), so we always write
// reason='other' and stash the note in `note`. If the UI later wants
// to pick a category, just expose it as a dropdown and switch this
// helper to read both fields.
//
// The booking layer (db.ts:isWithinBusinessHours) checks this table
// and rejects any attempt to book a slot on a holiday date.
// ---------------------------------------------------------------------------

router.get(
  '/business/:businessId/holidays',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('holidays')
      .select('id, date, reason, note, created_at')
      .eq('business_id', businessId)
      .order('date', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    // Surface the free-text reason as a top-level `reason` field for
    // the UI. The DB enum stays 'other' for now (see POST).
    const holidays = (data || []).map((h) => ({
      id: h.id,
      date: h.date,
      reason: h.note || '',
      reason_kind: h.reason,
    }));
    return res.json({ holidays });
  }
);

router.post(
  '/business/:businessId/holidays',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const { date, reason } = (req.body || {}) as {
      date?: string;
      reason?: string;
    };

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('holidays')
      .insert({
        business_id: businessId,
        date,
        reason: 'other',
        note: reason.trim(),
      })
      .select('id, date, reason, note')
      .single();

    if (error) {
      // 23505 = unique_violation on (business_id, date) — owner is
      // re-adding a closure for the same date.
      if (error.code === '23505') {
        return res.status(409).json({
          error: `A closure already exists for ${date}`,
        });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({
      holiday: {
        id: data.id,
        date: data.date,
        reason: data.note || '',
        reason_kind: data.reason,
      },
    });
  }
);

router.delete(
  '/business/:businessId/holidays/:holidayId',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId, holidayId } = req.params;
    const supabase = getSupabase();

    // Confirm ownership before delete (don't leak existence).
    const { data: existing } = await supabase
      .from('holidays')
      .select('business_id')
      .eq('id', holidayId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    if (existing.business_id !== businessId) {
      return res.status(404).json({ error: 'Holiday not found' });
    }

    const { error } = await supabase
      .from('holidays')
      .delete()
      .eq('id', holidayId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ id: holidayId });
  }
);

export default router;
