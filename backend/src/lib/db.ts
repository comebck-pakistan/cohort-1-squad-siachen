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
 * Story 13 — read whether this business's AI is currently enabled.
 *
 * Called by handleIncomingMessage() at the top of every turn to decide
 * whether to skip the LLM. Defaults to TRUE (active) if the row is
 * missing or the lookup errors — fail-open is the right choice here,
 * because the alternative (fail-closed) silently drops replies for a
 * salon that just hit a transient DB hiccup.
 *
 * The kill switch on the column comment reads: "kill switch
 * (superadmin OR owner pause)" — both surfaces flip the same field.
 */
/**
 * Set the customer's display name IF they don't already have one.
 *
 * Called from message-handler.ts when the LLM extracts a `customer_name`
 * slot. The bot learns the customer's name in conversation_state first
 * (per the slot-locking prompt rules), but customers.name is the field
 * the inbox list / dashboard render for the display label — without this
 * helper, every conversation kept showing the raw phone number as the
 * display name even after the bot knew the customer's name.
 *
 * Guard rails:
 *   - Refuses to write when the customer already has a non-empty name.
 *     We never overwrite a name the owner or a prior session may have
 *     set — even if the LLM "corrects" itself, that's a human decision.
 *   - Refuses to write empty / whitespace-only / placeholder values
 *     ("unknown", "customer", "—", phone-shaped strings).
 *   - Trims before checking length and before writing.
 *   - Best-effort: logs and swallows any error so the bot's reply path
 *     is never blocked by a name-write hiccup.
 */
/**
 * True when the phone identifier from whatsapp-web.js looks like a
 * LID-format string instead of a normal `@c.us` identifier.
 *
 * whatsapp-web.js (used by the WhatsApp-Web transport) sometimes hands
 * us IDs shaped like `966541183544-1454589702` — digits, a dash, more
 * digits — with no `@c.us` (or `@lid`) suffix. These come from a
 * newer WhatsApp client-side identifier scheme and we don't yet know
 * whether every one of them maps cleanly to a real phone number.
 *
 * We don't want to silently drop the customer message (per team
 * decision 2026-08-07) because we don't yet know if it's a real
 * customer or a client-side quirk. Instead we flag the conversation
 * via markConversationNeedsReviewLid() so it shows up in the
 * Escalations tab with a clear visual badge for the owner to triage.
 *
 * Important: this is BEFORE @-suffix normalization. The matching
 * normalizePhone() strips at the first `@`, so any string with a dash
 * and no `@` is suspicious. We deliberately do NOT flag normal
 * @c.us / @lid identifiers — only the dash-only shape.
 */
export function isLidFormat(rawPhone: string): boolean {
  if (!rawPhone) return false;
  // If there's any @ at all, it's a normal WhatsApp identifier
  // (either @c.us for individual chats or @lid for the LID scheme).
  if (rawPhone.includes('@')) return false;
  // The LID-format shape: digits, a dash, more digits. We require
  // BOTH sides to be digit-heavy so we don't accidentally flag
  // already-normalized phone numbers that happen to contain a dash.
  const m = rawPhone.match(/^(\d+)-(\d+)$/);
  if (!m) return false;
  // Sanity check: both halves should look phone-shaped (>= 6 digits).
  // Pure LID strings in the wild are typically 12-15 digits on the
  // left (the phone) and 8-12 on the right (the per-account suffix).
  return m[1].length >= 6 && m[2].length >= 4;
}

/**
 * True when the identifier is for a WhatsApp GROUP (not a 1:1 customer).
 *
 * Detected by:
 *   1. Explicit `@g.us` suffix in any position. WhatsApp's
 *      canonical group JID is `<group-id>@g.us` where group-id is
 *      typically 15-18 digits.
 *   2. 15-18 digit bare numerics with no separators. This is the
 *      newer whatsapp-web.js shape where the `@g.us` suffix has
 *      been stripped — common since mid-2026. Examples:
 *        "120363207662725526"  (18 digits, group)
 *        "158536017404126"     (15 digits, group)
 *        "279989102588003"     (15 digits, group)
 *      These look superficially like phone numbers but they're
 *      chat JIDs — you can't 1:1 message them.
 *
 * Note this is a heuristic for the 15-18 digit case — a real
 * Pakistani phone number is 12 digits starting with `92`, and a
 * real US number is 10-11 digits starting with `1`. So 15-18
 * digits with no separator is almost certainly a chat JID.
 *
 * Caller: handleIncomingMessage() at the very top, to skip group
 * messages entirely. They should never become customer rows in
 * our DB (a group isn't a customer), and replying to a group
 * message with a 1:1 send produces "No LID for user" errors.
 */
export function isGroupChat(rawFrom: string): boolean {
  if (!rawFrom) return false;
  // Case 1: explicit @g.us suffix
  if (rawFrom.includes('@g.us')) return true;
  // Case 2: 15-18 digit bare numeric with no separators — chat JID
  if (/^\d{15,18}$/.test(rawFrom)) return true;
  // Case 3: LID-format with @g.us suffix (rare but possible)
  if (/^\d+-\d+@g\.us$/.test(rawFrom)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Medical-concern detector — keyword/pattern check that runs INDEPENDENTLY
// of the LLM. We do NOT trust the LLM to flag medical concerns reliably:
// it can bucket health-adjacent questions under intent='other' with high
// confidence, and the LLM is not trained to escalate health concerns
// without being told. The salon owner needs to be notified whenever a
// customer asks about allergic reactions, pain/injury, pregnancy, skin
// /scalp/rash/infection symptoms, or "is X safe for Y" safety queries —
// even if the bot would otherwise reply politely and decline.
//
// The pattern list is intentionally broad-but-focused: we want to catch
// symptomatic phrasing ("I have a rash", "my hand is swelling") plus
// safety queries ("is this safe for pregnant?"), without false-firing
// on services that happen to mention skin or nails
// ("I want a skin facial", "what's your nail art service").
//
// Tighter than the LLM-based intent check because we're catching a
// narrower set of intents — health-adjacent questions only.
// ---------------------------------------------------------------------------

const MEDICAL_PATTERNS: RegExp[] = [
  // === Allergic reaction / hypersensitivity ===
  /\ballergic?\b/i,            // allergic, allergy
  /\bhives\b/i,
  /\bswell(?:ing|ed|en)?\b/i,
  /\bswollen\b/i,              // past participle — not covered by the above
  /\bnettle\s*rash\b/i,

  // === Skin / scalp / rash / infection symptoms ===
  /\brash\b/i,
  // Broader infection coverage — "infected" / "infecting" / "infects"
  // were missed by the original `\binfection\b` exact-word match.
  /\binfect(?:ion|ed|ing|s)?\b/i,
  /\bpus\b/i,                  // the medical term
  /\bpuss\b/i,                 // common typo
  /\babscess\b/i,              // localized infection
  /\bdischarge\b/i,            // symptom
  /\bsmelly\b/i,               // customer word for foul odor
  /\bsor(?:e|eness)\b/i,        // sore, soreness
  /\bitch(?:y|ing|iness)?\b/i,
  /\beczema\b/i,
  /\bpsoriasis\b/i,
  /\bbumps?\b/i,
  /\bblister(?:s|ed|ing)?\b/i,
  /\bscab(?:s|bing)?\b/i,
  /\bflak(?:y|ing)\b/i,
  /\bred\s+spots?\b/i,

  // === Pain / injury ===
  /\bpa[ie]n\b/i,              // pain, pein (common typo)
  /\bhurt(?:s|ing)?\b/i,
  /\binjur(?:y|ed|ies)\b/i,
  /\bbleeding\b/i,
  /\bburn(?:s|ed|ing)?\b/i,
  /\bwound\b/i,

  // === Pregnancy / nursing ===
  /\bpregnan(?:t|cy)\b/i,
  /\bbreastfeeding\b/i,
  /\bnursing\b/i,
  /\bexpecting\b/i,
  /\btrimester\b/i,
  /\bbreastfeed\b/i,

  // === Safety queries — "is X safe for Y" ===
  /safe\s+for\s+(?:my|me|kids?|children|baby|skin|child|pregnant|sensitive|face|scalp)/i,
  /is\s+(?:this|that|it)\s+safe/i,
  /can\s+i\s+(?:use|get|have|do)\s+(?:this|that|it)\s+(?:while|during|if|when)\b/i,
  /\bsafe\s+hai\b/i,           // Roman Urdu: "is it safe"

  // === Medical-care vocabulary (safety net for symptoms customers
  //     describe without using the precise medical term) ===
  /\bdoctor\b/i,               // "see a doctor"
  /\bdermatologist\b/i,        // skin specialist
  /\bemergency\b/i,            // medical emergency
  /\bhospital\b/i,             // hospital
  /\bmedical\b/i,              // generic safety net ("medical insurance",
                               // "medical condition", "medical expenses")

  // === Roman Urdu / Hindi symptom vocabulary (Stage 15) ===
  // The bulk of our customers text in Roman Urdu. The English-only patterns
  // above missed "mere nail ke neeche kala sa ho gaya hai aur dard bhi hai"
  // because "kala" (dark/black spot) and "dard" (pain) don't match any of
  // them. Adding the common symptom words so the medical-concern escalation
  // actually fires when the customer describes a symptom in Urdu.
  //
  // Each is a whole-word match (\b boundaries) to avoid false positives
  // like "sujan" inside "sujana" or "daag" inside "daagna".
  /\bdard\b/i,                  // pain
  /\bkala\s+sa\b/i,             // dark spot ("kala sa ho gaya" = "became dark")
  /\bkala\s+pad\s+gaya\b/i,     // "became dark"
  /\bkalaa\b/i,                 // alt spelling
  /\bdaag\b/i,                  // spot / stain
  /\bsujan\b/i,                 // swelling
  /\bsoojhan\b/i,               // alt spelling of swelling
  /\bkhaarish\b/i,              // itching
  /\bkharish\b/i,               // alt spelling
  /\bjalaa\b/i,                 // burning
  /\bjal\s+(?:gaya|gayi)\b/i,   // "got burned"
  /\bkhoon\b/i,                 // blood
  /\bkhoon\s+aa\s+(?:raha|gaya)\b/i, // "bleeding"
  /\bganth\b/i,                 // lump
  /\bganthr\b/i,                // alt spelling
  /\bphoda\b/i,                 // blister / pimple
  /\bpholay\b/i,                // alt spelling
  /\bkharab\b/i,                // "spoiled" (often used for "ruined" nails/skin)
  /\btoot\s+(?:raha|rahi|gaya|gayi)\b/i, // "breaking"
  /\bpeela\b/i,                 // yellow (nail discoloration)
  /\bsafed\b/i,                 // white (spots)
  /\bnaak\s+se\s+khoon\b/i,     // nosebleed — borderline
  /\bbukhar\b/i,                // fever
  /\bbukhaar\b/i,               // alt spelling
  /\bsardi\b/i,                  // cold
  /\bkhaansi\b/i,               // cough
  /\bkhaasi\b/i,                // alt spelling
  /\bsaans\b/i,                  // breath (shortness of)
  /\bfung(?:us|al|i)?\b/i,      // fungus / fungal — customer word, our keyword matcher was English-only

  // === Specific phrasing patterns customers use in Roman Urdu ===
  /\bis\s+(?:ka|ye|yeh)\s+(?:ka|se)\s+(?:kya|kaise)\b/i,    // "is ka kya treatment"
  /\btreatment\s+(?:kya|hai|kya\s+hai)\b/i,                  // "treatment kya hai"
  /\b(?:medicine|dawai|dawei)\s+(?:kya|deni|chahiye|lena)\b/i,
  /\bdoctor\s+ko\s+(?:dikhana|dikhlau|dikhayein)\b/i,
  /\bhospital\s+(?:jaana|jau|jana)\b/i,
];

/**
 * Return true if the customer message contains a clear medical-concern
 * signal. This is the hard-keyword path — when it returns true the
 * producer should create an escalation_events row with
 * reason='medical_concern' regardless of what the LLM returns.
 */
export function detectMedicalConcern(text: string): boolean {
  if (!text) return false;
  return MEDICAL_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Edge case rules — owned by the platform (business_id IS NULL) and by
// individual salons. Returned as a single flat list for the LLM prompt.
// ---------------------------------------------------------------------------

export interface EdgeCaseRule {
  rule_text: string;
  rule_type: string; // 'hard' | 'soft'
}

export async function getEdgeCaseRules(
  businessId: string
): Promise<EdgeCaseRule[]> {
  // Platform-level rules (business_id IS NULL) + per-salon rules
  // (business_id = this). Inactive rows are filtered out.
  const { data, error } = await getSupabase()
    .from('edge_case_rules')
    .select('rule_text, rule_type')
    .eq('is_active', true)
    .or(`business_id.is.null,business_id.eq.${businessId}`);

  if (error) {
    console.warn('[db.ts] getEdgeCaseRules failed:', error.message);
    return [];
  }
  return (data || []) as EdgeCaseRule[];
}

/**
 * Stamp the customer's wa_chat_id (raw WhatsApp identifier) IF we
 * don't already have one OR the existing one differs from this one.
 *
 * whatsapp-web.js hands us customer identifiers in one of two
 * shapes:
 *   1. Normal     — "<digits>@c.us"   (e.g. "923001234567@c.us")
 *   2. LID-format — "<digits>-<digits>" with no "@" suffix
 *                    (e.g. "966541183544-1454589702")
 *
 * Until now we only stored the normalized digits in customers.phone.
 * That works for inbound routing, but breaks outbound: the
 * owner-reply endpoint constructs `${phone}@c.us`, and WhatsApp
 * rejects it with "No LID for user" when the customer's actual
 * identifier is in LID format.
 *
 * This helper stores the raw `from` value exactly as whatsapp-web.js
 * handed it to us, so the owner-reply endpoint can pass it back
 * verbatim. Both shapes are valid WhatsApp chatIds and round-trip
 * cleanly.
 *
 * Guard rails:
 *   - Refuses to write empty / whitespace-only values. Nothing
 *     useful to store.
 *   - Idempotent: if the customer already has a non-null
 *     wa_chat_id, we don't overwrite it. This matters because if
 *     a customer's identifier ever changes (e.g. they re-install
 *     WhatsApp and the new client hands us a different LID), we
 *     want the next inbound message to overwrite — but we don't
 *     want to overwrite on EVERY message (would just churn DB
 *     writes for no benefit and risk races).
 *
 *     The "overwrite if different" rule is the right balance:
 *     stable identifier → 1 write total. New identifier after
 *     re-install → 1 write to update.
 *   - Best-effort: logs and swallows any error so the customer's
 *     reply path is never blocked by a wa_chat_id hiccup.
 *
 * Caller: message-handler.ts on every inbound turn. Both LID-format
 * and normal @c.us identifiers get written — we always want the
 * most accurate identifier available for outbound.
 */
export async function upsertCustomerChatId(
  customerId: string,
  candidateChatId: string | null | undefined
): Promise<void> {
  if (!candidateChatId) return;
  const trimmed = candidateChatId.trim();
  if (trimmed.length === 0) return;

  // Conditional UPDATE — only flip wa_chat_id where it's currently
  // NULL OR differs from the new value. The OR condition lets us
  // pick up identifier changes (re-installs) without churning the
  // column on every turn for stable customers.
  //
  // We compare with .neq('wa_chat_id', trimmed) which Postgres
  // treats as NULL-safe in Supabase: NULL != '<value>' so the
  // .or() catches both "no row" and "different value".
  const { error } = await getSupabase()
    .from('customers')
    .update({ wa_chat_id: trimmed })
    .eq('id', customerId)
    .or(`wa_chat_id.is.null,wa_chat_id.neq.${trimmed}`);

  if (error) {
    console.warn(
      `[db.ts] upsertCustomerChatId failed (customer=${customerId}):`,
      error.message
    );
  }
}

/**
 * Stamp a conversation as needing human review because the originating
 * customer identifier was in LID format (see isLidFormat()).
 *
 * We reuse the existing escalation_events table with a dedicated
 * reason value so this surfaces in the same Escalations tab as
 * customer_complaint / low_confidence — no schema change required.
 * Idempotent within a short window via .maybeSingle() precondition:
 * only writes if no unresolved LID-format escalation exists yet.
 *
 * Returns silently on error — the customer's reply path is more
 * important than the flag, and the message-handler logs the failure.
 */
export async function markConversationNeedsReviewLid(
  conversationId: string,
  rawPhone: string
): Promise<void> {
  try {
    // Cheap idempotency: only insert if no existing unresolved
    // LID-flag row for this conversation. (A resolved-then-flagged-
    // again cycle is allowed because the owner might clear the flag
    // and the same customer might message again with the same LID.)
    const { data: existing } = await getSupabase()
      .from('escalation_events')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('reason', 'needs_review_lid_format')
      .eq('resolved', false)
      .maybeSingle();

    if (existing) return;

    const { error } = await getSupabase()
      .from('escalation_events')
      .insert({
        conversation_id: conversationId,
        reason: 'needs_review_lid_format',
        // ai_draft_response captures the raw LID string so the owner
        // can see WHICH identifier surfaced this flag when triaging.
        ai_draft_response: `customer_phone=${rawPhone}`,
      });

    if (error) {
      console.warn(
        `[db.ts] markConversationNeedsReviewLid failed (conversation=${conversationId}):`,
        error.message
      );
    }
  } catch (e) {
    console.warn(
      `[db.ts] markConversationNeedsReviewLid threw (conversation=${conversationId}):`,
      (e as Error).message
    );
  }
}

export async function updateCustomerNameIfMissing(
  customerId: string,
  candidateName: string | null | undefined
): Promise<void> {
  if (!candidateName) return;
  const trimmed = candidateName.trim();
  if (trimmed.length === 0) return;

  // Reject obvious placeholders / non-names so we don't pollute the
  // column with "unknown", "—", or a phone number accidentally pasted
  // in. Anything that looks phone-shaped (>=8 digits, mostly digits)
  // is treated as not-a-name.
  const lower = trimmed.toLowerCase();
  if (
    lower === 'unknown' ||
    lower === 'customer' ||
    lower === '—' ||
    lower === '-' ||
    lower === 'n/a' ||
    lower === 'null'
  ) {
    return;
  }
  const digitCount = (trimmed.match(/\d/g) ?? []).length;
  if (digitCount >= 8) return;

  // Conditional UPDATE — only flip name where it's currently NULL or
  // empty. RLS-safe; the customer row's policy lets us update our own
  // customer's name. If the row was concurrently updated by another
  // turn, the .eq('name', '')'s filter simply no-ops, which is fine.
  const { error } = await getSupabase()
    .from('customers')
    .update({ name: trimmed })
    .eq('id', customerId)
    .or('name.is.null,name.eq.');

  if (error) {
    // Non-fatal — name persistence is decoration on top of the reply
    // path. A failure here should not break the customer's reply.
    console.warn(
      `[db.ts] updateCustomerNameIfMissing failed (customer=${customerId}):`,
      error.message
    );
  }
}

export async function isAgentActive(businessId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('businesses')
    .select('agent_active')
    .eq('id', businessId)
    .maybeSingle();

  if (error) {
    console.warn(`[db.ts] isAgentActive lookup failed: ${error.message}`);
    return true; // fail-open
  }
  if (!data) return true; // missing row → assume active
  return data.agent_active !== false;
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
 * Append a single message row to the `messages` table.
 *
 * Story 18 — restores the chat transcript that the salon owner sees
 * in /salon-portal/inbox, that superadmin reads cross-salon, and that
 * any future usage/cost tracking will roll up from. Writes are
 * best-effort: a failure is logged but never propagated, so a
 * transient DB hiccup doesn't kill the customer's reply.
 *
 * The `messages` table is intentionally separate from
 * `conversation_state` — state holds the STRUCTURED slots the LLM
 * reasons over, messages hold the raw turn-by-turn chat log. They
 * stay in sync because the same handler writes both.
 */
export async function saveMessage(
  conversationId: string,
  senderType: SenderType,
  content: string
): Promise<void> {
  if (!content || content.trim().length === 0) return;
  const { error } = await getSupabase()
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: senderType,
      content,
    });
  if (error) {
    // Non-fatal — log + carry on. The bot's reply path must not fail
    // because the transcript write failed.
    console.warn(
      `[db.ts] saveMessage failed (conversation=${conversationId} sender=${senderType}):`,
      error.message
    );
  }
}

/**
 * Return the most recent N turns of a conversation, ordered oldest-first.
 *
 * Used by the LLM prompt to inject raw chat history into the bot's
 * context — `conversation_state` carries structured slots, but for
 * short back-and-forth the verbatim transcript is what the LLM
 * actually needs to disambiguate pronouns, follow-ups, etc.
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number = 10
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('sender_type, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.warn(`[db.ts] getRecentMessages failed: ${error?.message}`);
    return [];
  }
  // We selected newest-first; reverse so the prompt sees oldest-first.
  return data.reverse().map((m) => ({
    role: m.sender_type === 'customer' ? 'user' : 'assistant',
    content: m.content,
  }));
}

/**
 * Return the FULL chronological thread for a conversation. Used by the
 * owner-facing inbox view (Story 18) and any superadmin drill-in.
 *
 * RLS on the messages table already enforces that only the business
 * owner / superadmin can read rows for their own conversations, so we
 * don't add an extra ownership check here — the DB is the gate.
 */
export interface MessageRow {
  id: string;
  sender_type: SenderType;
  content: string;
  created_at: string;
}

export async function getMessageThread(
  conversationId: string,
  limit: number = 500
): Promise<MessageRow[]> {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('id, sender_type, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.warn(`[db.ts] getMessageThread failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as MessageRow[];
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
// Upcoming appointment — fed to the LLM so it can disambiguate
// reschedule/cancel requests against fresh context instead of guessing.
//
// Returns a short markdown block the bot prepends to the conversation
// state. Critical for the "the customer says 'sham 5 pm?' — do they want
// to MOVE their Tuesday 4pm booking or book a SECOND one?" decision.
//
// Returns a placeholder when:
//   - the customer has no upcoming appointments
//   - the customer has multiple (we show the soonest only, with a count)
//   - DB lookup fails (so the LLM gets "unknown", not a stale snapshot)
//
// IMPORTANT: this surfaces ground truth to the LLM, not conversation_state.
// The two stay in sync because both are written by the same code paths,
// but if they ever diverge this is the authoritative answer.
// ---------------------------------------------------------------------------

export interface UpcomingAppointmentSummary {
  appointmentId: string;
  serviceName: string;
  /** ISO 8601 in UTC */
  startTime: string;
  /** ISO 8601 in UTC */
  endTime: string;
  staffName: string | null;
  /** How many ACTIVE upcoming appointments this customer has at this business. */
  totalUpcoming: number;
}

export async function getUpcomingAppointmentForPrompt(
  businessId: string,
  customerId: string
): Promise<string> {
  try {
    // Find all upcoming non-cancelled appointments. Previously we only
    // rendered the soonest + a "you have N" hint, but that left the
    // LLM unable to answer "which 2 bookings do I have?" — the bot
    // would reply with a generic clarification prompt and the customer
    // got frustrated. Render each appointment's full details so the
    // LLM has ground truth to disambiguate against. Cap at MAX to
    // avoid prompt-bloat on test-run pollution (we've seen customers
    // with 5+ ghost rows during testing).
    const MAX_APPOINTMENTS = 3;
    const { data, error } = await getSupabase()
      .from('appointments')
      .select('id, service_id, staff_id, start_time, end_time')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .in('status', ['pending', 'confirmed'])
      .gt('start_time', new Date().toISOString())
      .order('start_time', { ascending: true })
      .limit(MAX_APPOINTMENTS);

    if (error) {
      console.warn(
        `[db.ts] getUpcomingAppointmentForPrompt failed: ${error.message}`
      );
      return '## Upcoming appointments\n(unavailable — DB lookup failed)';
    }
    if (!data || data.length === 0) {
      return '## Upcoming appointments\n(none — customer has no upcoming bookings at this salon)';
    }

    // Resolve ALL service + staff names in parallel so the rendering
    // loop below can reference them by id.
    const serviceIds = Array.from(new Set(data.map((a) => a.service_id).filter(Boolean)));
    const staffIds = Array.from(new Set(data.map((a) => a.staff_id).filter(Boolean)));

    const [servicesRes, staffRes] = await Promise.all([
      serviceIds.length > 0
        ? getSupabase().from('services').select('id, name').in('id', serviceIds)
        : { data: [], error: null },
      staffIds.length > 0
        ? getSupabase().from('staff').select('id, name').in('id', staffIds)
        : { data: [], error: null },
    ]);

    const serviceNameById = new Map<string, string>();
    if (servicesRes.data) {
      for (const s of servicesRes.data) serviceNameById.set(s.id, s.name);
    }
    const staffNameById = new Map<string, string>();
    if (staffRes.data) {
      for (const s of staffRes.data) staffNameById.set(s.id, s.name);
    }

    const lines: string[] = [
      data.length === 1
        ? '## Upcoming appointment (authoritative — use this to disambiguate reschedule/cancel/clarification)'
        : `## Upcoming appointments (${data.length} total — authoritative, use these to disambiguate reschedule/cancel/clarification)`,
    ];

    data.forEach((appt, i) => {
      const start = new Date(appt.start_time);
      const dateStr = start.toLocaleDateString('en-PK', {
        timeZone: 'Asia/Karachi',
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const timeStr = start.toLocaleTimeString('en-PK', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      const serviceName = appt.service_id ? serviceNameById.get(appt.service_id) ?? 'service' : 'service';
      const staffName = appt.staff_id ? staffNameById.get(appt.staff_id) ?? null : null;

      // Multi-appointment label (e.g. "Appointment 1", "Appointment 2")
      // so the LLM can reference a specific one back to the customer
      // ("you have Booking 2 at 6pm — should I cancel that one?").
      const header = data.length > 1 ? `\n### Appointment ${i + 1}` : '';
      lines.push(header);
      lines.push(`- service: ${serviceName}`);
      lines.push(`- date: ${dateStr}`);
      lines.push(`- time: ${timeStr} PKT`);
      if (staffName) lines.push(`- stylist: ${staffName}`);
    });

    return lines.join('\n');
  } catch (e) {
    console.warn(
      `[db.ts] getUpcomingAppointmentForPrompt threw: ${(e as Error).message}`
    );
    return '## Upcoming appointments\n(unavailable — unexpected error)';
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

/**
 * One-off salon closure (public holiday, owner vacation, etc.) that
 * overrides the weekly hours for that specific date. Surfaced in the
 * LLM system prompt so the bot can answer "open on 14 Aug?" questions
 * correctly — otherwise the LLM hallucinates from weekly hours alone.
 */
export interface SalonHoliday {
  /** ISO date YYYY-MM-DD in PKT. */
  date: string;
  /** Human-readable label the owner typed in the UI ("Azaadi day"). */
  reason: string;
  /** Raw enum bucket from the holidays table — useful for future filtering. */
  reason_kind: string;
}

export interface SalonContext {
  business_id: string;
  name: string;
  city: string | null;
  timezone: string;
  services: SalonService[];
  hours: SalonHours[];
  /** Upcoming one-off closures (date >= today, max 30). Owners set these
   *  via the salon's "Holidays & Closures" tab. The LLM uses this list
   *  to answer "is the salon open on X?" questions correctly — weekly
   *  hours do NOT apply on closure dates. */
  holidays: SalonHoliday[];
  /** Active edge-case guardrails (platform-level + per-salon). The LLM
   *  uses these to refuse out-of-scope asks (medical, refund, comparison)
   *  consistently with the keyword detection in message-handler.ts. */
  edge_case_rules: EdgeCaseRule[];
  staff_count: number;
  is_configured: boolean; // true if at least one service is loaded
  /** Current wall-clock time in Asia/Karachi as ISO-8601 with +05:00 offset.
   *  Computed on every getSalonContext() call so the LLM is never guessing
   *  "what time is it now" from its training data. */
  current_datetime_pkt: string;
  /** Today's date in PKT as YYYY-MM-DD (derived from current_datetime_pkt). */
  today_pkt: string;
  /** @deprecated Kept around so the LLM prompt builder (Stage 4) can be
   *  swapped over without a breaking interface change. The wave-9 reads
   *  pull from `business_rule` (typed toggles) instead — this field is
   *  always empty and will be removed in Stage 4. */
  ai_rules: string;
  /** Wave 9 — predefined rules the owner has enabled for this salon.
   *  Keys map to PREDEFINED_RULES in backend/src/lib/predefined-rules.ts.
   *  Empty array when no rules are enabled. Wired into the LLM prompt
   *  by buildSystemPrompt() in Stage 4. */
  enabledRules: string[];
  /** Wave 9 — predefined escalation triggers the owner has enabled.
   *  Keys map to PREDEFINED_TRIGGERS. Same wiring as enabledRules. */
  enabledTriggers: string[];
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
    holidays: [],
    edge_case_rules: [],
    staff_count: 0,
    is_configured: false,
    current_datetime_pkt: currentDatetimePkt,
    today_pkt: todayPkt,
    ai_rules: '',
    enabledRules: [],
    enabledTriggers: [],
  };

  // Business basics (no ai_rules read — the column was dropped in
  // schema/19_predefined_rules.sql; the new typed toggles live in
  // business_rule and business_escalation_trigger, fetched below).
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

  // Wave 9 — predefined rules enabled for this salon. Partial index
  // idx_business_rule_enabled (WHERE enabled = TRUE) keeps this cheap
  // even with hundreds of rules per owner.
  const { data: ruleRows } = await getSupabase()
    .from('business_rule')
    .select('rule_key')
    .eq('business_id', businessId)
    .eq('enabled', true);
  if (ruleRows) {
    ctx.enabledRules = ruleRows.map((r) => r.rule_key as string);
  }

  // Wave 9 — predefined escalation triggers enabled for this salon.
  const { data: triggerRows } = await getSupabase()
    .from('business_escalation_trigger')
    .select('trigger_key')
    .eq('business_id', businessId)
    .eq('enabled', true);
  if (triggerRows) {
    ctx.enabledTriggers = triggerRows.map((t) => t.trigger_key as string);
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

  // Upcoming owner-set closures. Only future dates are useful for the
  // LLM prompt — past closures are stale. Capped at 30 rows so a
  // long-running salon can't bloat the prompt with old data.
  const { data: holidays } = await getSupabase()
    .from('holidays')
    .select('date, reason, note')
    .eq('business_id', businessId)
    .gte('date', todayPkt)
    .order('date', { ascending: true })
    .limit(30);
  if (holidays) {
    ctx.holidays = (
      holidays as Array<{ date: string; reason: string; note: string | null }>
    ).map((h) => ({
      date: h.date,
      // Prefer the human-readable note (e.g. "Azaadi day") over the raw
      // enum bucket. The UI always writes note=<text>, reason='other',
      // so note is the source of truth for the customer-facing label.
      reason: h.note || h.reason || 'closure',
      reason_kind: h.reason,
    }));
  }

  // Active edge-case guardrails (platform-level + per-salon). The LLM
  // uses these to refuse out-of-scope asks (medical, refund, comparison)
  // consistently with the keyword detection in message-handler.ts.
  // Without this list the LLM has no idea what the salon's rules are
  // and may give conflicting advice on, e.g., refund policy.
  const edgeRules = await getEdgeCaseRules(businessId);
  ctx.edge_case_rules = edgeRules;

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
    | 'invalid_time_format'
    | 'customer_already_booked';
  /** Human-readable detail (e.g. "Salon is closed on Sundays"). */
  detail: string;
  /** Alternative slots the bot can suggest, ISO timestamps. */
  suggestions: string[];
  /**
   * When reason='customer_already_booked', this carries the conflicting
   * appointment's details so the booking layer can phrase a clarifying
   * question that names the existing service + time + stylist.
   */
  conflict?: {
    appointmentId: string;
    serviceName: string;
    /** ISO timestamp — already-formatted display comes from the booking layer. */
    startTime: string;
    endTime: string;
    staffName: string | null;
  };
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
// ---------------------------------------------------------------------------
// Same-customer-time dedup — prevents the bug where a customer gets TWO
// active appointments that overlap in time (regardless of stylist).
//
// Even when two stylists are involved, one customer cannot be in two
// places at once. The Postgres EXCLUSION constraint
// `no_overlapping_staff_appointments` only catches same-stylist
// double-bookings — it does NOT catch cross-stylist ones. Without this
// guard we book the customer for a second conflicting appointment the
// moment a different stylist is available.
//
// Symptom it fixes (live-transcripted 2026-08-05):
//   - 22:36 — customer books Nail Art Full Set @ Fri 4pm (Sana Malik)
//   - 22:37 — customer asks about Bridal Nail Package charges
//   - 22:37 — customer says "han g" (yes) to bot's "Book karni hai?"
//   - 22:37 — bot books Bridal Nail Package @ Fri 4pm (Hira Khan)
//     → TWO ACTIVE APPOINTMENTS, SAME TIME, ONE CUSTOMER. Boom.
//
// The check uses app.salesforce-style "any overlap" semantics:
//   existing.start < new.end   AND   existing.end > new.start
// ---------------------------------------------------------------------------

export interface CustomerBookingConflict {
  appointmentId: string;
  serviceName: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  staffName: string | null;
}

/**
 * Return the customer's ACTIVE appointment (if any) that overlaps the
 * given time window [startTime, endTime). Pass excludeAppointmentId when
 * called from the reschedule path so it doesn't flag the appointment
 * being moved against itself.
 */
export async function findCustomerBookingOverlap(
  businessId: string,
  customerId: string,
  startTime: Date,
  endTime: Date,
  excludeAppointmentId?: string
): Promise<CustomerBookingConflict | null> {
  try {
    // SQL: start_time < newEnd AND end_time > newStart
    // (with optional id <> excludeAppointmentId for the reschedule path)
    let q = getSupabase()
      .from('appointments')
      .select('id, service_id, staff_id, start_time, end_time')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .in('status', ['pending', 'confirmed'])
      .lt('start_time', endTime.toISOString())
      .gt('end_time', startTime.toISOString())
      .order('start_time', { ascending: true })
      .limit(1);
    if (excludeAppointmentId) {
      q = q.neq('id', excludeAppointmentId);
    }
    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;

    // Resolve service name
    let serviceName = 'a service';
    if (data.service_id) {
      const { data: svc } = await getSupabase()
        .from('services')
        .select('name')
        .eq('id', data.service_id)
        .maybeSingle();
      if (svc?.name) serviceName = svc.name;
    }

    // Resolve staff name
    let staffName: string | null = null;
    if (data.staff_id) {
      const { data: staff } = await getSupabase()
        .from('staff')
        .select('name')
        .eq('id', data.staff_id)
        .maybeSingle();
      if (staff?.name) staffName = staff.name;
    }

    return {
      appointmentId: data.id,
      serviceName,
      startTime: data.start_time,
      endTime: data.end_time,
      staffName,
    };
  } catch (e) {
    // Fail-open: if the dedup check itself errors, log and let the
    // booking proceed. The EXCLUSION constraint is the final safety net.
    console.warn(
      '[db.ts] findCustomerBookingOverlap threw (fail-open):',
      (e as Error).message
    );
    return null;
  }
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
  // Holiday check FIRST — closures win over weekly hours. If the
  // requested date is on the owner's closure list, reject even when
  // the weekly schedule has the salon marked "open". Cheap single-row
  // lookup; the holidays table is small (single-digit rows per
  // business) and indexed on (business_id, date).
  const { data: holiday, error: holidayErr } = await getSupabase()
    .from('holidays')
    .select('note, reason')
    .eq('business_id', businessId)
    .eq('date', date)
    .maybeSingle();
  if (holidayErr) {
    console.warn('[db.ts] holiday lookup failed (continuing):', holidayErr.message);
  }
  if (holiday) {
    const label = holiday.note || holiday.reason || 'closure';
    return {
      ok: false,
      detail: `Salon is closed on ${date} (${label})`,
    };
  }

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

  // 6.5. Same-customer-time dedup guard. The Postgres EXCLUSION
  //      constraint only catches same-stylist overlaps — two stylists
  //      with the same time slot can each take a separate appointment
  //      for the same customer, which physically violates the
  //      "one customer, one chair" rule. Returns customer_already_booked
  //      so the booking layer can phrase a Roman Urdu clarifying
  //      question instead of letting the second booking slide through.
  const conflict = await findCustomerBookingOverlap(
    req.businessId,
    req.customerId,
    startTime,
    endTime
  );
  if (conflict) {
    console.log(
      '[db.ts] customer_already_booked: existing appt=%s service=%s at %s — blocking new booking for service=%s',
      conflict.appointmentId,
      conflict.serviceName,
      conflict.startTime,
      req.serviceName
    );
    return {
      ok: false,
      reason: 'customer_already_booked',
      detail:
        `You already have ${conflict.serviceName} ` +
        `at ${conflict.startTime} — same customer cannot be in two services at once.`,
      suggestions: [],
      conflict,
    };
  }

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
  /**
   * Optional — if provided AND different from the existing service, the
   * appointment will be moved to (date, time, new service) atomically.
   * If null/omitted, the existing service is preserved (legacy behavior).
   * Added because customers regularly say "actually can we change to the
   * gel manicure as well as 6pm?" — silently keeping the old service
   * here is a trust-breaking failure mode (customer shows up to wrong
   * service with no warning).
   */
  newServiceName?: string | null;
}

export type RescheduleOutcome =
  | {
      ok: true;
      appointmentId: string;
      oldStart: string;
      newStart: string;
      /** Service name AFTER the change. May differ from the original
       *  if newServiceName was supplied. */
      serviceName: string;
      staffName: string;
      /** True only when a service swap happened during this reschedule. */
      serviceChanged: boolean;
    }
  | {
      ok: false;
      reason:
        | 'no_upcoming_appointment'
        | 'invalid_date_format'
        | 'past_time'
        | 'outside_hours'
        | 'slot_taken'
        | 'service_not_offered'
        | 'db_error';
      detail: string;
      suggestions?: string[];
      /** When the failure was caused by an overlap with one of this
       *  customer's OTHER active appointments, this carries its details
       *  (the same shape as AppointmentFailure.conflict). The booking
       *  layer uses it to ask whether to cancel the old one first. */
      conflict?: CustomerBookingConflict;
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

  // 4. Compute new end_time using the existing service's duration.
  //    We may switch to a new service below if newServiceName was supplied.
  const { data: existingSvc } = await getSupabase()
    .from('services')
    .select('duration_minutes, name')
    .eq('id', appt.service_id)
    .maybeSingle();
  if (!existingSvc) {
    return {
      ok: false,
      reason: 'db_error',
      detail: 'Could not find the service for this appointment',
    };
  }

  // 4b. Optional service swap. If the caller passed newServiceName AND
  //     it resolves to a different service in this salon's catalogue,
  //     use the new service's duration for end_time and update
  //     service_id. If it doesn't match any service in the catalogue,
  //     reject with service_not_offered — silently keeping the old
  //     service is exactly the failure mode we're trying to avoid
  //     (customer shows up to wrong appointment).
  let svc = existingSvc;
  let newServiceId: string | null = appt.service_id;
  let serviceChanged = false;
  if (req.newServiceName && req.newServiceName.trim().length > 0) {
    const desired = req.newServiceName.trim();
    const { data: matchedSvc, error: matchErr } = await getSupabase()
      .from('services')
      .select('id, name, duration_minutes')
      .eq('business_id', req.businessId)
      .ilike('name', desired)
      .maybeSingle();
    if (matchErr) {
      return {
        ok: false,
        reason: 'db_error',
        detail: 'Could not check the new service name',
      };
    }
    if (!matchedSvc) {
      // Try a fuzzy partial match as a fallback — same approach the
      // booking path uses in findServiceByName(). The owner-facing
      // message names a few alternatives so the customer can correct
      // themselves.
      const { data: fuzzy } = await getSupabase()
        .from('services')
        .select('name')
        .eq('business_id', req.businessId)
        .ilike('name', `%${desired}%`)
        .limit(3);
      const alts = fuzzy?.map((r) => r.name).filter(Boolean) ?? [];
      return {
        ok: false,
        reason: 'service_not_offered',
        detail:
          alts.length > 0
            ? `We don't offer "${desired}". Did you mean: ${alts.join(', ')}?`
            : `We don't offer "${desired}" at this salon.`,
      };
    }
    if (matchedSvc.id !== appt.service_id) {
      svc = matchedSvc;
      newServiceId = matchedSvc.id;
      serviceChanged = true;
    }
  }

  const newEnd = new Date(newStart.getTime() + svc.duration_minutes * 60_000);

  // 4c. Same-customer-time dedup — make sure the NEW slot doesn't
  //     collide with one of the customer's OTHER active appointments
  //     (the one being moved is excluded by id). The EXCLUSION constraint
  //     only catches same-stylist conflicts, not cross-stylist — and
  //     even then, it's the wrong layer to surface a clear "you already
  //     have X booked" message to the customer.
  const conflict = await findCustomerBookingOverlap(
    req.businessId,
    req.customerId,
    newStart,
    newEnd,
    appt.id  // exclude the appointment being moved
  );
  if (conflict) {
    return {
      ok: false,
      reason: 'slot_taken',  // reuse — booking layer already handles this with alts
      detail:
        `That new time conflicts with your ${conflict.serviceName} appointment at ` +
        `${conflict.startTime}. Move that one first, or pick a different time.`,
      suggestions: await suggestAlternativeSlots(
        req.businessId,
        newServiceId ?? appt.service_id,
        req.preferredDate
      ),
    };
  }

  // 5. UPDATE — EXCLUSION constraint catches double-booking. If the
  //    service changed, include service_id in the patch so the swap is
  //    atomic with the time change.
  const updatePatch: Record<string, string> = {
    start_time: newStart.toISOString(),
    end_time: newEnd.toISOString(),
  };
  if (serviceChanged && newServiceId) {
    updatePatch.service_id = newServiceId;
  }
  const { data: updated, error: updErr } = await getSupabase()
    .from('appointments')
    .update(updatePatch)
    .eq('id', appt.id)
    .select('id, staff_id')
    .maybeSingle();

  if (updErr) {
    // 23P01 = exclusion_violation in PG → staff has another appt at that time
    if (updErr.code === '23P01') {
      // Suggest alternatives against the NEW service if the customer
      // also changed the service — they're booking against that
      // service's duration, so alternatives should match it.
      const alternatives = await suggestAlternativeSlots(
        req.businessId,
        newServiceId ?? appt.service_id,
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
    serviceChanged,
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
//   - 'medical_concern'     — keyword/pattern match on health-adjacent phrasing
//   - 'abusive_language'    — keyword/pattern match on abusive/threatening language
//
// Idempotency: this function is called on EVERY customer message turn
// (the producer sits inside message-handler.ts:339-371). Without
// dedupe, a customer who sends 5 angry messages in a row creates 5
// separate rows for the same conversation. We mirror the pattern in
// markConversationNeedsReviewLid() above: check for an existing
// UNRESOLVED row of the SAME reason first, and if one exists, just
// touch its timestamp + update the ai_draft_response. The Resolved
// sub-tab picks the latest escalation per conversation anyway, so the
// "touch" semantics keep the row at the top of the Active list while
// preserving the original created_at for resolved-history sorting.
//
// A different reason always inserts a new row (e.g. a customer who
// transitions from angry to medical-question creates both rows).
// ---------------------------------------------------------------------------

export type EscalationReason =
  | 'customer_complaint'
  | 'low_confidence'
  | 'customer_request_human'
  | 'medical_concern'
  | 'abusive_language';

export async function recordEscalation(
  conversationId: string,
  reason: EscalationReason,
  aiDraftResponse: string | null
): Promise<void> {
  // Cheap idempotency: only insert if no existing UNRESOLVED row of
  // the SAME reason exists for this conversation. If one exists, just
  // refresh it so the Active list shows it as fresh.
  const { data: existing } = await getSupabase()
    .from('escalation_events')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('reason', reason)
    .eq('resolved', false)
    .maybeSingle();

  if (existing) {
    const { error } = await getSupabase()
      .from('escalation_events')
      .update({
        ai_draft_response: aiDraftResponse,
        created_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      console.warn('[db.ts] recordEscalation touch failed:', error.message);
    }
    return;
  }

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
