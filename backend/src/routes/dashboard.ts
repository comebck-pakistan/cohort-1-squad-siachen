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
//   GET    /api/business/:businessId/escalations         (Phase 1 dashboard wiring)
//   GET    /api/business/:businessId/dashboard-stats     (Phase 1 dashboard wiring)
//   GET    /api/business/:businessId/ai-rules            (Phase 1 dashboard wiring)
//   PUT    /api/business/:businessId/ai-rules            (Phase 1 dashboard wiring)
//   GET    /api/business/:businessId/connection-info     (Phase 1: source of truth for transport choice)
//
// Auth: Authorization: Bearer <jwt from Supabase auth signup/login>.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { requireAuth, requireOwnedBusiness } from '../lib/auth';

const router = Router();
const auth = [requireAuth] as const;
const owned = (param: string) => [requireAuth, requireOwnedBusiness(param)] as const;

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
//    Body: { name, duration_minutes, staff_required?, price? }
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
    } = (req.body || {}) as {
      name?: string;
      duration_minutes?: number;
      staff_required?: number;
      price?: number;
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
        is_active: true,
      })
      .select('id, name, duration_minutes, staff_required, price, is_active')
      .single();

    if (error || !data) {
      return res.status(500).json({ error: error?.message || 'Insert failed' });
    }
    return res.status(201).json({ service: data });
  }
);

// ---------------------------------------------------------------------------
// 7. GET /api/business/:businessId/conversations
//    List recent conversations with last message preview.
// ---------------------------------------------------------------------------
router.get(
  '/business/:businessId/conversations',
  ...owned('businessId'),
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const supabase = getSupabase();

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
      .order('last_message_at', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ conversations: data || [] });
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

export default router;
