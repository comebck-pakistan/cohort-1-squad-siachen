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

  const lines: string[] = ['## Conversation state'];
  if (data.current_intent)    lines.push(`- Intent: ${data.current_intent}`);
  if (data.service_interest)  lines.push(`- Service interest: ${data.service_interest}`);
  if (data.preferred_date)    lines.push(`- Preferred date: ${data.preferred_date}`);
  if (data.preferred_time)    lines.push(`- Preferred time: ${data.preferred_time}`);
  if (data.customer_name)     lines.push(`- Customer name: ${data.customer_name}`);
  if (data.customer_phone)    lines.push(`- Customer phone: ${data.customer_phone}`);
  if (data.status)            lines.push(`- Status: ${data.status}`);
  if (data.outcome)           lines.push(`- Outcome: ${data.outcome}`);
  if (data.last_customer_msg) lines.push(`- Last customer said: "${data.last_customer_msg}"`);
  if (data.last_agent_msg)    lines.push(`- Last agent said: "${data.last_agent_msg}"`);
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
  };

  // Business basics
  const { data: biz } = await getSupabase()
    .from('businesses')
    .select('name, city, timezone')
    .eq('id', businessId)
    .maybeSingle();
  if (biz) {
    ctx.name = biz.name;
    ctx.city = biz.city;
    ctx.timezone = biz.timezone || 'Asia/Karachi';
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
