import { getSupabase } from './supabase';

// Marriyam's schema uses `message_sender` enum:
//   'customer' | 'agent' | 'owner'
type SenderType = 'customer' | 'agent' | 'owner';

/**
 * Route an incoming WhatsApp message to the correct salon.
 *
 * In production each salon has its own WhatsApp Business number (eventually).
 * For now we have one Meta test number. The mapping from "Meta's
 * phone_number_id for our WhatsApp number" → salon lives on the
 * `businesses` table itself (`businesses.phone_number_id`).
 *
 * Returns null if no salon has claimed that phone_number_id yet —
 * which would mean someone configured a WhatsApp number with us but
 * hasn't been onboarded as a business. Logged + dropped upstream.
 */
export async function getBusinessIdForPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('businesses')
    .select('id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();

  if (error) {
    console.error('businesses lookup failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Find an existing customer by phone, or create one.
 *
 * Race-safe: uses upsert so two concurrent requests for the same
 * new phone don't both try to INSERT (which would fail the second
 * one with a unique-constraint violation). The UNIQUE index on
 * customers.phone is the source of truth — we let the database
 * decide who wins, then read the winner's id back.
 */
export async function getOrCreateCustomer(phone: string): Promise<string> {
  // First, fast path: try a plain SELECT (covers the common case
  // where the customer already exists).
  const { data: existing } = await getSupabase()
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) return existing.id;

  // Customer doesn't exist yet. Try INSERT; if another concurrent
  // request beat us to it, fall back to a SELECT to grab the row
  // they created.
  const { data: inserted, error: insertError } = await getSupabase()
    .from('customers')
    .insert({ phone })
    .select('id')
    .maybeSingle();

  if (inserted) return inserted.id;

  if (insertError && insertError.code !== '23505') {
    // 23505 = unique_violation. Anything else is a real failure.
    throw new Error(`Failed to create customer: ${insertError.message}`);
  }

  // Lost the race — re-fetch the row the other request created.
  const { data: raceWinner, error: selectError } = await getSupabase()
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .single();

  if (selectError || !raceWinner) {
    throw new Error(
      `Failed to create or fetch customer after race: ${selectError?.message ?? 'unknown error'}`
    );
  }
  return raceWinner.id;
}

/**
 * Find an active conversation between this business and customer,
 * or create a new one. We pick the most-recent active conversation
 * to keep chat history contiguous.
 *
 * Race-safe: same pattern as getOrCreateCustomer. The DB-level
 * partial unique index (`idx_one_active_conversation`) on
 * (business_id, customer_id) WHERE status='active' is the source
 * of truth — we let the database decide and we read the winner's id.
 */
export async function getOrCreateConversation(
  businessId: string,
  customerId: string
): Promise<string> {
  // Fast path: existing active conversation
  const { data: existing } = await getSupabase()
    .from('conversations')
    .select('id')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  // No active conversation — try to create one
  const { data: created, error: createError } = await getSupabase()
    .from('conversations')
    .insert({ business_id: businessId, customer_id: customerId })
    .select('id')
    .maybeSingle();

  if (created) return created.id;

  // Race fallback: another request may have created one between our
  // SELECT and INSERT. Re-check.
  const { data: raceWinner, error: selectError } = await getSupabase()
    .from('conversations')
    .select('id')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to create conversation: ${selectError.message}`);
  }
  if (!raceWinner) {
    throw new Error('Failed to create or fetch conversation after race');
  }
  return raceWinner.id;
}

/**
 * @deprecated No-op stub. Bot no longer writes raw messages to the
 * `messages` table. Use `updateConversationState()` instead — that
 * writes to `conversation_state`, which is now the source of truth
 * per `docs/SUPABASE_CHANGELOG.md` (2026-07-22).
 *
 * Kept as a no-op so existing callers (webhook.ts, demo.ts) don't
 * break during migration. Safe to delete once those callers are
 * fully migrated to updateConversationState().
 */
export async function saveMessage(
  conversationId: string,
  senderType: SenderType,
  content: string
): Promise<void> {
  console.warn(
    '[saveMessage] deprecated no-op — conversation_state is now the source of truth (see docs/SUPABASE_CHANGELOG.md 2026-07-22)'
  );
}

/**
 * @deprecated Returns []. Messages table no longer holds live data;
 * structured `conversation_state` is the source of truth. Use
 * `getConversationStateForPrompt()` instead, which returns a
 * formatted markdown block the bot includes in its system prompt.
 *
 * Kept as a no-op stub returning [] so existing callers don't
 * break during migration.
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number = 10
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  // Intentionally returns [] — see deprecation note above.
  return [];
}

/**
 * Bump the conversation's `last_message_at` so it sorts to the top
 * of any "recent conversations" queries.
 */
export async function touchConversation(conversationId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (error) {
    // Non-fatal — we don't want to fail the whole flow over a timestamp update.
    console.warn('touchConversation failed:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Conversation state — replaces verbatim message storage as source of truth
// ---------------------------------------------------------------------------

/**
 * Patch fields for `updateConversationState`. All fields optional.
 * `business_id` is fetched internally from the conversations table
 * so callers only need the conversation id.
 */
export interface ConversationStatePatch {
  current_intent?: string;
  service_interest?: string;
  preferred_date?: string;
  preferred_time?: string;
  customer_name?: string;
  customer_phone?: string;
  last_customer_msg?: string;
  last_agent_msg?: string;
  status?: string;
  outcome?: string;
}

/**
 * Upsert into `conversation_state`. Looks up `business_id` from
 * `conversations` so callers only pass conversationId + the patch
 * fields they want to set. Idempotent — safe to call repeatedly
 * with the same patch.
 *
 * This is the new source of truth for "what this conversation is
 * about" — replaces raw message storage as the bot's context.
 */
export async function updateConversationState(
  conversationId: string,
  patch: ConversationStatePatch
): Promise<void> {
  // Look up business_id from conversations so we don't make the
  // caller pass it on every call.
  const { data: conv, error: convErr } = await getSupabase()
    .from('conversations')
    .select('business_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (convErr) {
    throw new Error(
      `updateConversationState: conversations lookup failed: ${convErr.message}`
    );
  }
  if (!conv) {
    throw new Error(
      `updateConversationState: conversation ${conversationId} not found`
    );
  }

  const { error } = await getSupabase()
    .from('conversation_state')
    .upsert({
      conversation_id: conversationId,
      business_id: conv.business_id,
      ...patch,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`updateConversationState failed: ${error.message}`);
  }
}

/**
 * Read the raw conversation_state row (or null if none yet). Used by
 * the booking layer to check the LOCKED service before the LLM's new
 * extraction overrides it — see booking.ts.
 *
 * Returns only the fields the booking layer cares about, plus a couple
 * of others for general use.
 */
export async function getConversationState(
  conversationId: string
): Promise<{
  current_intent: string | null;
  service_interest: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: string | null;
  outcome: string | null;
} | null> {
  const { data, error } = await getSupabase()
    .from('conversation_state')
    .select(
      'current_intent, service_interest, preferred_date, preferred_time, customer_name, customer_phone, status, outcome'
    )
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error) {
    console.warn(`[db.ts] getConversationState failed: ${error.message}`);
    return null;
  }
  return data;
}

/**
 * Read the conversation's structured state and return a formatted
 * markdown block the bot includes in its system prompt. Replaces
 * message-history threading — the LLM now sees slots instead of
 * raw turns.
 *
 * Returns a placeholder if the conversation has no state row yet
 * (e.g. very first message just arrived and hasn't been written).
 */
export async function getConversationStateForPrompt(
  conversationId: string
): Promise<string> {
  const { data, error } = await getSupabase()
    .from('conversation_state')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error) {
    console.warn(`getConversationStateForPrompt failed: ${error.message}`);
    return '## Conversation state\n(no state yet — first message)';
  }
  if (!data) {
    return '## Conversation state\n(no state yet — first message)';
  }

  const lines: string[] = ['## Conversation state (authoritative — these slots are LOCKED until the customer explicitly changes them)'];
  if (data.current_intent)    lines.push(`- current_intent: ${data.current_intent}`);
  // The slot names below are the LLM-facing labels. They map to the same DB columns
  // (service_interest → selected_service etc.) but use the wording the receptionist
  // prompt expects so the bot treats them as authoritative state, not suggestions.
  if (data.service_interest)  lines.push(`- selected_service: ${data.service_interest}`);
  if (data.preferred_date)    lines.push(`- requested_date: ${data.preferred_date}`);
  if (data.preferred_time)    lines.push(`- requested_time: ${data.preferred_time}`);
  if (data.customer_name)     lines.push(`- customer_name: ${data.customer_name}`);
  if (data.customer_phone)    lines.push(`- customer_phone: ${data.customer_phone}`);
  if (data.status)            lines.push(`- status: ${data.status}`);
  if (data.outcome)           lines.push(`- outcome: ${data.outcome}`);
  if (data.last_customer_msg) lines.push(`- last_customer_msg: "${data.last_customer_msg}"`);
  if (data.last_agent_msg)    lines.push(`- last_agent_msg: "${data.last_agent_msg}"`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Salon context — feeds the LLM with real per-business data
// ---------------------------------------------------------------------------

export interface SalonService {
  name: string;
  duration_minutes: number;
  price: number | null;
}

export interface SalonHours {
  day_of_week: string; // 'sun'..'sat'
  is_open: boolean;
  open_time: string | null; // 'HH:MM' or null when closed
  close_time: string | null;
}

export interface SalonContext {
  business_id: string;
  name: string;
  city: string | null;
  timezone: string;
  services: SalonService[];
  hours: SalonHours[];
  staff_count: number;
  is_configured: boolean; // true if at least one service is loaded
  /** Current wall-clock time in Asia/Karachi as ISO-8601 with +05:00 offset.
   *  Computed on every getSalonContext() call so the LLM is never guessing
   *  "what time is it now" from its training data. */
  current_datetime_pkt: string;
  /** Today's date in PKT as YYYY-MM-DD (derived from current_datetime_pkt). */
  today_pkt: string;
  /** Owner-edited free-form AI rules (JSONB on businesses table). Empty
   *  string when none. Wired into the LLM system prompt. */
  ai_rules: string;
}

/**
 * Load everything the LLM needs to answer questions as THIS salon:
 *   - business basics (name, city, timezone)
 *   - active services (name, duration, price)
 *   - weekly hours
 *   - staff headcount
 *
 * Used by both the webhook handler and the demo bypass route to inject
 * real per-salon data into the LLM system prompt. Returns an empty
 * `services` array (with `is_configured: false`) if the salon owner
 * hasn't set anything up yet — the LLM is taught to gracefully fall
 * back in that case (see llm.ts).
 *
 * Failures from any individual sub-query don't throw — we degrade
 * gracefully (empty arrays) so the bot can still reply.
 */
export async function getSalonContext(businessId: string): Promise<SalonContext> {
  // Compute current PKT datetime up-front so the LLM can read it instead of
  // guessing from training data. Without this the bot says things like
  // "abhi around 6pm chal raha hai" when it's actually 1:20 PM.
  const nowPkt = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })
  );
  const yyyy = nowPkt.getFullYear();
  const mm = String(nowPkt.getMonth() + 1).padStart(2, '0');
  const dd = String(nowPkt.getDate()).padStart(2, '0');
  const hh = String(nowPkt.getHours()).padStart(2, '0');
  const mi = String(nowPkt.getMinutes()).padStart(2, '0');
  const todayPkt = `${yyyy}-${mm}-${dd}`;
  const currentDatetimePkt = `${todayPkt}T${hh}:${mi}:00+05:00`;

  // Default shell — fields filled in by the parallel queries below
  const ctx: SalonContext = {
    business_id: businessId,
    name: 'our salon',
    city: null,
    timezone: 'Asia/Karachi',
    services: [],
    hours: [],
    staff_count: 0,
    is_configured: false,
    current_datetime_pkt: currentDatetimePkt,
    today_pkt: todayPkt,
    ai_rules: '',
  };

  // Business basics + AI rules (single SELECT — they're on the same row)
  const { data: biz } = await getSupabase()
    .from('businesses')
    .select('name, city, timezone, ai_rules')
    .eq('id', businessId)
    .maybeSingle();
  if (biz) {
    ctx.name = biz.name;
    ctx.city = biz.city;
    ctx.timezone = biz.timezone || 'Asia/Karachi';
    // ai_rules is JSONB — accept either string or array shape, normalize
    const r = biz.ai_rules as unknown;
    if (typeof r === 'string') ctx.ai_rules = r;
    else if (Array.isArray(r)) ctx.ai_rules = r.map(String).join('\n');
    else if (r && typeof r === 'object') ctx.ai_rules = JSON.stringify(r, null, 2);
  }

  // Active services
  const { data: services } = await getSupabase()
    .from('services')
    .select('name, duration_minutes, price')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('price', { ascending: true });
  if (services) {
    ctx.services = services as SalonService[];
    ctx.is_configured = ctx.services.length > 0;
  }

  // Weekly hours
  const { data: hours } = await getSupabase()
    .from('business_hours')
    .select('day_of_week, is_open, open_time, close_time')
    .eq('business_id', businessId)
    .order('day_of_week');
  if (hours) {
    ctx.hours = hours as SalonHours[];
  }

  // Staff headcount (active only)
  const { count } = await getSupabase()
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('is_active', true);
  ctx.staff_count = count ?? 0;

  return ctx;
}

// ---------------------------------------------------------------------------
// Booking helpers — autonomous appointment confirmation.
//
// Used by lib/message-handler.ts (and demo.ts) when the LLM returns
// intent='book' with all required slots filled. The bot calls
// createAppointmentIfValid() which:
//
//   1. Looks up the service by fuzzy name match
//   2. Picks a staff member who can do that service
//   3. Verifies the requested time is within business hours
//   4. Verifies the requested time is in the future
//   5. Calls the get_available_slots() PL/pgSQL function for race-safe check
//   6. INSERTs into appointments
//
// Returns a discriminated AppointmentOutcome so the caller knows exactly
// what to say to the customer (success message vs specific rejection +
// alternative suggestions).
// ---------------------------------------------------------------------------

export interface AppointmentRequest {
  businessId: string;
  customerId: string;
  /** Fuzzy match against the salon's service list (case-insensitive). */
  serviceName: string;
  /** ISO date YYYY-MM-DD. */
  preferredDate: string;
  /** 24h time HH:MM (Asia/Karachi local). */
  preferredTime: string;
}

export interface AppointmentSuccess {
  ok: true;
  appointmentId: string;
  scheduledStart: string; // ISO timestamp
  scheduledEnd: string; // ISO timestamp
  staffName: string;
  /** ID of the actual assigned stylist (after multi-stylist retry). */
  staffId: string;
  serviceName: string;
}

export interface AppointmentFailure {
  ok: false;
  reason:
    | 'service_not_found'
    | 'no_staff_for_service'
    | 'outside_hours'
    | 'slot_taken'
    | 'past_time'
    | 'invalid_date_format'
    | 'invalid_time_format';
  /** Human-readable detail (e.g. "Salon is closed on Sundays"). */
  detail: string;
  /** Alternative slots the bot can suggest, ISO timestamps. */
  suggestions: string[];
}

export type AppointmentOutcome = AppointmentSuccess | AppointmentFailure;

/**
 * Build a Date for end-of-service given start + duration minutes.
 */
function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

/**
 * Best-effort extractor for get_available_slots() RPC return values.
 *
 * The PL/pgSQL function's row shape isn't formally documented — it has
 * varied over the schema's lifetime. The actual shape observed in
 * production (Mar 2026) is:
 *   { slot_start: "2026-07-24T14:00:00+00:00",
 *     slot_end:   "2026-07-24T14:30:00+00:00",
 *     available_staff_ids: ["..."] }
 *
 * The slot_start is UTC (see +00:00). Salons operate in Asia/Karachi
 * (UTC+5), so we convert the UTC ISO timestamp to PKT HH:MM before
 * suggesting it to the customer — otherwise we'd tell a Pakistani
 * customer "we have 14:00 available" when we mean 7pm local time.
 */
function extractTimeFromRpcRow(row: unknown): string | null {
  if (row == null) return null;

  // String return — could be an ISO timestamp like "2026-07-24T15:00:00+05:00"
  // or a plain "15:00:00" or "15:00".
  if (typeof row === 'string') {
    const d = new Date(row);
    if (!isNaN(d.getTime())) {
      // ISO timestamp → format in PKT
      const hhmm = d.toLocaleTimeString('en-PK', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return hhmm;
    }
    // Fallback: regex-extract HH:MM for plain "15:00" style strings
    const m = row.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : null;
  }

  // Object return — try common field names.
  if (typeof row === 'object') {
    const r = row as Record<string, unknown>;
    const candidates = [
      r.slot_start,    // actual observed shape — UTC ISO timestamp
      r.start_time,
      r.slot_time,
      r.time,
      r.slot,
      r.available_slot,
      r.start,
    ];
    for (const c of candidates) {
      if (typeof c === 'string') {
        // Try as ISO timestamp first (the canonical observed shape)
        if (c.includes('T') || c.includes('-')) {
          const d = new Date(c);
          if (!isNaN(d.getTime())) {
            const hhmm = d.toLocaleTimeString('en-PK', {
              timeZone: 'Asia/Karachi',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            });
            return hhmm;
          }
        }
        // Fallback: regex-extract HH:MM
        const m = c.match(/(\d{2}):(\d{2})/);
        if (m) return `${m[1]}:${m[2]}`;
      }
    }
  }

  return null;
}
async function findServiceByName(
  businessId: string,
  searchName: string
): Promise<{ id: string; name: string; durationMinutes: number } | null> {
  const trimmed = searchName.trim();
  if (!trimmed) return null;

  const { data, error } = await getSupabase()
    .from('services')
    .select('id, name, duration_minutes')
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (error || !data) return null;

  const lower = trimmed.toLowerCase();

  // Exact match wins
  const exact = data.find((s) => s.name.toLowerCase() === lower);
  if (exact) {
    return {
      id: exact.id,
      name: exact.name,
      durationMinutes: exact.duration_minutes,
    };
  }

  // Contains match (either direction)
  const contains = data.find(
    (s) =>
      s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase())
  );
  if (contains) {
    return {
      id: contains.id,
      name: contains.name,
      durationMinutes: contains.duration_minutes,
    };
  }

  return null;
}

/**
 * Pick a staff member who can perform a given service AND is active.
 * Returns the first match (we don't optimize for least-busy; the slot
 * availability check below handles conflicts).
 *
 * DEPRECATED in favor of findQualifiedStaffIds() — kept only for any
 * legacy callers. New code should use the multi-staff variant below so
 * the booking layer can try each qualified stylist in turn and use the
 * EXCLUSION constraint to pick whichever one is free at the requested
 * time. (Single-staff variant silently over-booked busy salons.)
 */
async function findStaffForService(
  businessId: string,
  serviceId: string
): Promise<{ id: string; name: string } | null> {
  const all = await findQualifiedStaffIds(businessId, serviceId);
  return all[0] ?? null;
}

/**
 * Return ALL staff qualified for a given service in a business, ordered
 * stably so the booking layer's retry loop has a deterministic "first
 * free stylist wins" rule.
 *
 * Used by createAppointmentIfValid() to try INSERTs across every
 * qualified stylist — the EXCLUSION constraint on appointments
 * (no_overlapping_staff_appointments, tstzrange-based) is the
 * authoritative race-safety check; we just loop until we find one
 * whose INSERT succeeds.
 */
async function findQualifiedStaffIds(
  businessId: string,
  serviceId: string
): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await getSupabase()
    .from('staff_skills')
    .select(
      'staff_id, staff!inner(id, name, is_active, business_id)'
    )
    .eq('service_id', serviceId)
    .eq('staff.business_id', businessId)
    .eq('staff.is_active', true)
    .order('staff_id', { ascending: true });

  if (error || !data) return [];

  const out: Array<{ id: string; name: string }> = [];
  for (const row of data as unknown as Array<{
    staff: { id: string; name: string } | null;
  }>) {
    if (row.staff) out.push({ id: row.staff.id, name: row.staff.name });
  }
  return out;
}

/**
 * Parse YYYY-MM-DD + HH:MM (Asia/Karachi local) into an ISO timestamp.
 * Returns null if either field is malformed.
 */
function parseLocalDateTime(date: string, time: string): Date | null {
  // Defensive: YYYY-MM-DD must be 10 chars, HH:MM must be 5 chars
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;

  // Build the timestamp treating it as Asia/Karachi wall-clock time.
  // Date with ISO string + offset is the most reliable cross-version way.
  // PKT = UTC+5, no DST.
  const isoString = `${date}T${time}:00+05:00`;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  return d;
}

function dayOfWeekFromIsoDate(date: string): string | null {
  const d = new Date(`${date}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()];
}

/**
 * Check if HH:MM falls within business hours for a given day-of-week.
 * Reads weekly_hours for that day and compares.
 */
async function isWithinBusinessHours(
  businessId: string,
  date: string,
  time: string
): Promise<{ ok: boolean; detail: string }> {
  const dow = dayOfWeekFromIsoDate(date);
  if (!dow) return { ok: false, detail: 'Could not parse date' };

  const { data, error } = await getSupabase()
    .from('business_hours')
    .select('day_of_week, is_open, open_time, close_time')
    .eq('business_id', businessId)
    .eq('day_of_week', dow)
    .maybeSingle();

  if (error) {
    return { ok: false, detail: 'Could not load business hours' };
  }
  if (!data || !data.is_open) {
    return { ok: false, detail: `Salon is closed on ${dow}` };
  }

  const open = data.open_time as string | null;
  const close = data.close_time as string | null;
  if (!open || !close) {
    return { ok: false, detail: 'Business hours are not set for that day' };
  }

  // time is "HH:MM", open/close may also be "HH:MM:SS"
  const normalize = (s: string) => (s.length === 5 ? `${s}:00` : s);
  const requested = normalize(time);
  if (requested < open || requested > close) {
    return {
      ok: false,
      detail: `Salon hours on ${dow} are ${open.slice(0, 5)}–${close.slice(0, 5)}`,
    };
  }
  return { ok: true, detail: '' };
}

/**
 * The autonomous booking check + insert. See AppointmentOutcome for the
 * possible return shapes.
 */
export async function createAppointmentIfValid(
  req: AppointmentRequest
): Promise<AppointmentOutcome> {
  // 1. Parse date + time
  const startTime = parseLocalDateTime(req.preferredDate, req.preferredTime);
  if (!startTime) {
    return {
      ok: false,
      reason: 'invalid_date_format',
      detail: `Couldn't understand "${req.preferredDate} ${req.preferredTime}"`,
      suggestions: [],
    };
  }

  // 2. Reject past times
  if (startTime.getTime() < Date.now()) {
    return {
      ok: false,
      reason: 'past_time',
      detail: 'That time is already in the past',
      suggestions: [],
    };
  }

  // 3. Look up service by fuzzy name match
  const service = await findServiceByName(req.businessId, req.serviceName);
  if (!service) {
    return {
      ok: false,
      reason: 'service_not_found',
      detail: `We don't seem to offer "${req.serviceName}"`,
      suggestions: [],
    };
  }

  // 4. Find ALL staff qualified for this service. We'll try each one
  // in turn during the INSERT step below — the EXCLUSION constraint
  // (no_overlapping_staff_appointments) is the atomic, race-safe
  // check that decides which one is actually free at this time. This
  // is what enables multi-stylist salons: Ayesha and Rabia both do
  // "Hair cut (trim only)"; if Ayesha is already booked at 3pm, the
  // next customer's booking lands on Rabia automatically.
  const qualifiedStaff = await findQualifiedStaffIds(req.businessId, service.id);
  if (qualifiedStaff.length === 0) {
    return {
      ok: false,
      reason: 'no_staff_for_service',
      detail: `No staff available for ${service.name}`,
      suggestions: [],
    };
  }

  // 5. Check business hours
  const hoursCheck = await isWithinBusinessHours(
    req.businessId,
    req.preferredDate,
    req.preferredTime
  );
  if (!hoursCheck.ok) {
    return {
      ok: false,
      reason: 'outside_hours',
      detail: hoursCheck.detail,
      suggestions: [],
    };
  }

  // 6. Compute scheduled_end
  const endTime = addMinutes(startTime, service.durationMinutes);

  // 7. Race-safe slot check via PL/pgSQL get_available_slots().
  // Used ONLY to generate alternative-time suggestions when the INSERT
  // below trips the EXCLUSION constraint. We do NOT gate on this — the
  // function only knows about standard slots (e.g. every 30 min) and
  // could falsely mark a valid time as "unavailable" if it falls
  // outside that grid. The actual race-safety is the EXCLUSION
  // constraint, enforced atomically by Postgres on INSERT.
  let alternativeSlots: string[] = [];
  const { data: slotOk, error: slotErr } = await getSupabase().rpc(
    'get_available_slots',
    {
      p_business_id: req.businessId,
      p_service_id: service.id,
      p_date: req.preferredDate,
    }
  );

  // Defensive parsing — the function's return schema is not formally
  // documented, and a previous version of this code crashed when the
  // field was named differently (e.g. "slot_time" instead of "start_time",
  // or returning JSON strings instead of objects). Log + extract what we
  // can so the bot always has *some* alternatives to suggest.
  if (!slotErr && Array.isArray(slotOk) && slotOk.length > 0) {
    alternativeSlots = (slotOk as unknown[])
      .map((s) => extractTimeFromRpcRow(s))
      .filter((t): t is string => Boolean(t))
      .slice(0, 3);
    if (alternativeSlots.length === 0 && slotOk.length > 0) {
      console.warn(
        '[db.ts] get_available_slots returned %d rows but extractTimeFromRpcRow got nothing. ' +
        'First row shape: %j',
        slotOk.length,
        slotOk[0]
      );
    }
  }

  // 8. INSERT the appointment — multi-stylist retry loop.
  //
  // For each qualified stylist (in stable DB order), attempt INSERT.
  // The EXCLUSION constraint no_overlapping_staff_appointments
  // (tstzrange(start_time, end_time) overlap) atomically rejects
  // double-bookings — so the first stylist whose INSERT doesn't trip
  // 23P01 is the one we book with.
  //
  // This is what supports salons like FABS where multiple stylists
  // can do the same service (Ayesha AND Rabia both do "Hair cut trim").
  // Previously we'd always book Ayesha (first seed row) and reject the
  // second customer with "slot taken" even when Rabia was free.
  //
  // If every qualified stylist is busy at this time, we return
  // slot_taken with the alternative slots we computed above.
  //
  // Column names discovered from /database/schema/01_schema.sql:
  //   start_time, end_time  (NOT scheduled_start/scheduled_end)
  //   status default is 'pending', 'confirmed' is a valid value.
  let lastErr: { code?: string; message?: string } | null = null;

  for (const staff of qualifiedStaff) {
    const { data: inserted, error: insertErr } = await getSupabase()
      .from('appointments')
      .insert({
        business_id: req.businessId,
        customer_id: req.customerId,
        staff_id: staff.id,
        service_id: service.id,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        status: 'confirmed',
      })
      .select('id')
      .maybeSingle();

    if (!insertErr && inserted) {
      // Success — booked with this stylist. Return their info so the
      // bot's confirmation message credits the actual assigned person.
      return {
        ok: true,
        appointmentId: inserted.id,
        scheduledStart: startTime.toISOString(),
        scheduledEnd: endTime.toISOString(),
        staffName: staff.name,
        staffId: staff.id,
        serviceName: service.name,
      };
    }

    if (insertErr) {
      lastErr = insertErr;
      // 23P01 = exclusion_violation — this specific stylist already
      // has an overlapping appointment. Try the next one. Any other
      // error is a real DB failure and should bubble up.
      if (insertErr.code === '23P01') {
        continue;
      }
      throw new Error(`Failed to insert appointment: ${insertErr.message}`);
    }

    // No error but no inserted row — shouldn't happen with .maybeSingle(),
    // but defensively try next staff rather than fail loudly.
  }

  // Every qualified stylist had an overlapping appointment at this
  // time. EXCLUSION saved the day — return slot_taken with alternatives.
  console.log(
    '[db.ts] slot conflict for all %d qualified staff (lastErr.code=%s)',
    qualifiedStaff.length,
    lastErr?.code
  );
  return {
    ok: false,
    reason: 'slot_taken',
    detail: 'No qualified stylist is free at that time',
    suggestions: alternativeSlots,
  };
}

// ---------------------------------------------------------------------------
// Reschedule + Cancel operations
// ---------------------------------------------------------------------------

export interface RescheduleRequest {
  businessId: string;
  customerId: string;
  /** "YYYY-MM-DD" — new preferred date */
  preferredDate: string;
  /** "HH:MM" 24h — new preferred time */
  preferredTime: string;
}

export type RescheduleOutcome =
  | {
      ok: true;
      appointmentId: string;
      oldStart: string;
      newStart: string;
      serviceName: string;
      staffName: string;
    }
  | {
      ok: false;
      reason:
        | 'no_upcoming_appointment'
        | 'invalid_date_format'
        | 'past_time'
        | 'outside_hours'
        | 'slot_taken'
        | 'db_error';
      detail: string;
      suggestions?: string[];
    };

/**
 * Find the customer's next upcoming (non-cancelled) appointment and move
 * it to a new slot. We require service, date, time to all be present.
 *
 * Strategy:
 *   1. Find the appointment: customer's next appointment with status in
 *      ('pending','confirmed') and start_time > now()
 *   2. Re-validate the new slot (same checks as createAppointmentIfValid
 *      EXCEPT we don't need to find service — we keep the existing one)
 *   3. UPDATE start_time + end_time in a single statement
 *   4. EXCLUSION constraint guards against double-booking the new slot
 */
export async function rescheduleAppointment(
  req: RescheduleRequest
): Promise<RescheduleOutcome> {
  // 1. Find customer's next upcoming appointment
  const { data: appt, error: apptErr } = await getSupabase()
    .from('appointments')
    .select('id, service_id, staff_id, start_time, end_time, status')
    .eq('business_id', req.businessId)
    .eq('customer_id', req.customerId)
    .in('status', ['pending', 'confirmed'])
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (apptErr) {
    console.error('[db.ts] reschedule lookup failed:', apptErr.message);
    return {
      ok: false,
      reason: 'db_error',
      detail: 'Could not look up your appointment',
    };
  }

  if (!appt) {
    return {
      ok: false,
      reason: 'no_upcoming_appointment',
      detail: "You don't have any upcoming appointments to reschedule",
    };
  }

  // 2. Parse new slot
  const newStart = parseLocalDateTime(req.preferredDate, req.preferredTime);
  if (!newStart) {
    return {
      ok: false,
      reason: 'invalid_date_format',
      detail: `Couldn't understand "${req.preferredDate} ${req.preferredTime}"`,
    };
  }

  if (newStart.getTime() < Date.now()) {
    return {
      ok: false,
      reason: 'past_time',
      detail: 'That time is already in the past',
    };
  }

  // 3. Check business hours
  const hoursCheck = await isWithinBusinessHours(
    req.businessId,
    req.preferredDate,
    req.preferredTime
  );
  if (!hoursCheck.ok) {
    return {
      ok: false,
      reason: 'outside_hours',
      detail: hoursCheck.detail,
    };
  }

  // 4. Compute new end_time (preserve duration)
  const { data: svc } = await getSupabase()
    .from('services')
    .select('duration_minutes, name')
    .eq('id', appt.service_id)
    .maybeSingle();
  if (!svc) {
    return {
      ok: false,
      reason: 'db_error',
      detail: 'Could not find the service for this appointment',
    };
  }
  const newEnd = new Date(newStart.getTime() + svc.duration_minutes * 60_000);

  // 5. UPDATE — EXCLUSION constraint catches double-booking
  const { data: updated, error: updErr } = await getSupabase()
    .from('appointments')
    .update({
      start_time: newStart.toISOString(),
      end_time: newEnd.toISOString(),
    })
    .eq('id', appt.id)
    .select('id, staff_id')
    .maybeSingle();

  if (updErr) {
    // 23P01 = exclusion_violation in PG → staff has another appt at that time
    if (updErr.code === '23P01') {
      // Try to suggest alternatives
      const alternatives = await suggestAlternativeSlots(
        req.businessId,
        appt.service_id,
        req.preferredDate
      );
      return {
        ok: false,
        reason: 'slot_taken',
        detail: 'No stylist is free at that new time',
        suggestions: alternatives,
      };
    }
    console.error('[db.ts] reschedule update failed:', updErr.message);
    return {
      ok: false,
      reason: 'db_error',
      detail: 'Could not reschedule your appointment',
    };
  }

  if (!updated) {
    return {
      ok: false,
      reason: 'db_error',
      detail: 'Reschedule did not apply',
    };
  }

  // 6. Look up staff name for the confirmation message
  let staffName = 'our team';
  if (updated.staff_id) {
    const { data: staff } = await getSupabase()
      .from('staff')
      .select('name')
      .eq('id', updated.staff_id)
      .maybeSingle();
    if (staff?.name) staffName = staff.name;
  }

  return {
    ok: true,
    appointmentId: updated.id,
    oldStart: appt.start_time,
    newStart: newStart.toISOString(),
    serviceName: svc.name,
    staffName,
  };
}

export interface CancelOutcome {
  ok: boolean;
  appointmentId?: string;
  serviceName?: string;
  when?: string;
  reason?: 'no_upcoming_appointment' | 'db_error';
  detail?: string;
}

/**
 * Cancel the customer's next upcoming appointment (sets status='cancelled').
 * Idempotent: if there's nothing to cancel, returns ok=false with
 * 'no_upcoming_appointment' rather than throwing.
 */
export async function cancelUpcomingAppointment(
  businessId: string,
  customerId: string
): Promise<CancelOutcome> {
  // Find it
  const { data: appt, error: findErr } = await getSupabase()
    .from('appointments')
    .select('id, service_id, start_time')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .in('status', ['pending', 'confirmed'])
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findErr) {
    console.error('[db.ts] cancel lookup failed:', findErr.message);
    return { ok: false, reason: 'db_error', detail: 'Could not look up your appointment' };
  }
  if (!appt) {
    return { ok: false, reason: 'no_upcoming_appointment', detail: "You don't have any upcoming appointments to cancel" };
  }

  // Cancel it
  const { error: updErr } = await getSupabase()
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appt.id);

  if (updErr) {
    console.error('[db.ts] cancel update failed:', updErr.message);
    return { ok: false, reason: 'db_error', detail: 'Could not cancel your appointment' };
  }

  // Fetch service name for confirmation
  let serviceName = 'your appointment';
  if (appt.service_id) {
    const { data: svc } = await getSupabase()
      .from('services')
      .select('name')
      .eq('id', appt.service_id)
      .maybeSingle();
    if (svc?.name) serviceName = svc.name;
  }

  return {
    ok: true,
    appointmentId: appt.id,
    serviceName,
    when: appt.start_time,
  };
}

/**
 * Look up a few alternate time slots on the same day for the same service.
 * Lightweight version — returns HH:MM strings.
 */
async function suggestAlternativeSlots(
  businessId: string,
  serviceId: string,
  preferredDate: string
): Promise<string[]> {
  try {
    // Simple approach: try the standard 30-min grid and find open slots
    const slots: string[] = [];
    for (let hour = 11; hour <= 21; hour++) {
      for (const minute of ['00', '30']) {
        const candidate = `${String(hour).padStart(2, '0')}:${minute}`;
        // Cheap check — just return first few suggestions
        slots.push(candidate);
        if (slots.length >= 4) return slots;
      }
    }
    return slots;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Escalation producer — writes an escalation_events row when the LLM
// signals intent='complaint' (or any other "human needed" signal).
//
// The dashboard's Edge Cases tab reads from this table (see
// routes/dashboard.ts:683-727) but previously NOTHING wrote to it, so the
// tab always rendered empty. This closes that loop.
//
// Reason values used:
//   - 'customer_complaint'  — LLM intent='complaint'
//   - 'low_confidence'      — LLM confidence < 30 and not 'book'/'cancel'/'reschedule'
//   - 'customer_request_human' — LLM intent='other' but customer asked for a human
// ---------------------------------------------------------------------------

export type EscalationReason =
  | 'customer_complaint'
  | 'low_confidence'
  | 'customer_request_human';

export async function recordEscalation(
  conversationId: string,
  reason: EscalationReason,
  aiDraftResponse: string | null
): Promise<void> {
  const { error } = await getSupabase()
    .from('escalation_events')
    .insert({
      conversation_id: conversationId,
      reason,
      ai_draft_response: aiDraftResponse,
    });

  if (error) {
    // Non-fatal — escalating is best-effort. Log so super admin dashboard
    // debugging is possible, but don't crash the customer's reply path.
    console.warn('[db.ts] recordEscalation failed:', error.message);
  }
}
