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
 * Find an existing customer by phone, or create a new row.
 * Customers are platform-wide (one phone can belong to multiple salons).
 */
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
 * Race-safe: same pattern as getOrCreateCustomer. Conversations
 * don't have a natural unique constraint to lean on (the natural
 * key would be (business_id, customer_id, status='active'), but
 * status='resolved' can have many rows), so we use a SELECT-then-
 * INSERT-with-fallback pattern.
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
 * Insert a single message into the conversation log.
 * `sender_type` matches Marriyam's `message_sender` enum.
 */
export async function saveMessage(
  conversationId: string,
  senderType: SenderType,
  content: string
): Promise<void> {
  const { error } = await getSupabase()
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: senderType,
      content,
    });

  if (error) {
    throw new Error(`Failed to save message: ${error.message}`);
  }
}

/**
 * Load the most recent N messages in a conversation, ordered
 * oldest-first. Used to give the LLM conversation history so it
 * doesn't reply out of context when a customer says "tomorrow 3pm"
 * without restating what they want to book.
 *
 * Returns messages in OpenAI's expected format: alternating
 * user/assistant roles. The customer maps to 'user', the agent
 * (bot) maps to 'assistant'. Owner messages are excluded — those
 * are admin interventions we don't want the bot to see.
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number = 10
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('sender_type, content, created_at')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['customer', 'agent'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.warn('getRecentMessages failed:', error?.message);
    return [];
  }

  // Reverse so oldest is first, then map to OpenAI roles
  return data
    .slice()
    .reverse()
    .map((m) => ({
      role: m.sender_type === 'customer' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));
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
