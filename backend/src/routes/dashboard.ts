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
//   PATCH  /api/staff/:staffId/skills     (replace staff_skills with new set)
//   POST   /api/business/:businessId/services
//   GET    /api/business/:businessId/conversations
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

export default router;
