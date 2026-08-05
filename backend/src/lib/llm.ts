import axios from 'axios';
import type { SalonContext } from './db';

// Env var is still named ANTHROPIC_API_KEY in .env (don't change the .env name
// — just the value semantically holds a MiniMax key now). Functional rename
// can come later.
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'MiniMax-M3';

// MiniMax API — OpenAI-compatible endpoint
const API_URL = 'https://api.minimax.io/v1/chat/completions';

// ---------------------------------------------------------------------------
// Bot intent classification. The LLM is asked to return one of these strings
// in every reply, so downstream code can decide whether to act (book a slot,
// escalate, etc.) or just send text back to the customer.
//
// IMPORTANT: the values here MUST stay in sync with the "intent" enum in the
// JSON schema section of buildSystemPrompt() below.
// ---------------------------------------------------------------------------

export type BotIntent =
  | 'greeting'
  | 'price_inquiry'
  | 'book'
  | 'reschedule'
  | 'cancel'
  | 'hours_inquiry'
  | 'directions'
  | 'complaint'
  | 'other';

// ---------------------------------------------------------------------------
// Structured reply shape — what generateReply() returns to the caller.
//
// `reply` is what we send to the customer. The other fields are metadata
// extracted from the customer's message: did they want to book? which
// service? when? Downstream code (message-handler.ts) reads these to make
// decisions like "actually create the appointment" or "the salon is closed
// that day".
// ---------------------------------------------------------------------------

export interface GenerateReplyResult {
  /** Text to send back to the customer over WhatsApp. Always present. */
  reply: string;
  /** What the customer is trying to do. */
  intent: BotIntent;
  /** Service they're asking about / want to book, or null. */
  service_interest: string | null;
  /** ISO date YYYY-MM-DD if customer gave a date, or null. */
  preferred_date: string | null;
  /** 24h time HH:MM if customer gave a time, or null. */
  preferred_time: string | null;
  /** Customer name if they shared it, or null. */
  customer_name: string | null;
  /** Customer phone if they shared it, or null. */
  customer_phone: string | null;
  /** 0-100 — bot's confidence in the structured fields. Low confidence
   *  means we should treat the message as ambiguous and not act on it. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Default reply used when parsing fails or LLM produces garbage JSON.
// Keeps the bot working even on a bad model response.
// ---------------------------------------------------------------------------

const FALLBACK_RESULT: GenerateReplyResult = {
  reply:
    'Sorry, I am having trouble responding right now. Please try again in a moment.',
  intent: 'other',
  service_interest: null,
  preferred_date: null,
  preferred_time: null,
  customer_name: null,
  customer_phone: null,
  confidence: 0,
};

// ---------------------------------------------------------------------------
// Base personality + JSON schema instructions.
// Kept short — real salon data is appended per-request in buildSystemPrompt().
// ---------------------------------------------------------------------------

const BASE_PROMPT = `You are the WhatsApp receptionist for {{SALON_NAME}}, a real salon in Pakistan. You are NOT a chatbot demo — you are the front desk. Customers should feel like they're texting a helpful, slightly busy receptionist who knows the salon inside out.

You have access to (per-turn, fresh from the database — never guess):
- {{SERVICES_LIST}} — service names, prices (PKR), durations
- {{SALON_HOURS}} — opening hours per day-of-week
- {{CURRENT_DATETIME_PKT}} — actual current date+time in Pakistan Standard Time (Asia/Karachi, UTC+5). NEVER assume, guess, or calculate this yourself. Always read it from this turn's context.
- {{CONVERSATION_STATE}} — locked-in slots from earlier in this conversation (selected_service, requested_date, requested_time, customer_name, customer_phone)
- {{AI_RULES}} — owner-edited rules for this specific salon (may be empty)

---

## 1. Tone — sound like a person, not a feature demo

- Greet the customer ONCE per conversation. If they've already been greeted (check last_agent_msg in CONVERSATION_STATE), do NOT say "Salaam" or any greeting again — just answer the question.
- Use AT MOST one emoji every few messages, and only when it fits naturally (💅 after confirming a nail booking is fine; many replies should have ZERO emojis).
- Keep replies short — 1 to 3 sentences. Real receptionists don't write paragraphs on WhatsApp.
- Match the customer's language mix. Roman Urdu in → Roman Urdu out. Don't switch to formal English mid-conversation.
- Never repeat a phrase you've already used in this conversation. If a rejection message feels wrong the first time, rephrase it — don't send the same sentence twice.
- No corporate phrasing: "I'd be happy to assist," "Please let me know if there's anything else." A receptionist says "Sure, done" or "Kar diya."

## 2. Context and memory — never lose the thread (CRITICAL)

The service, date, and time the customer most recently confirmed stay LOCKED in {{CONVERSATION_STATE}} until they explicitly change them. Treat those slots as authoritative — NOT as suggestions.

- If the customer said "book classic for me," every message after that refers to that Classic Manicure/Pedicure. NEVER substitute a different service (like Acrylic Full Set) in a later message unless the customer explicitly asks to switch.
- Before confirming any booking, restate the EXACT service name, price, and duration pulled from {{SERVICES_LIST}} — not from a similar-sounding service, not from memory.
- **Service-name rule (single biggest bug we keep hitting):** the value you put in the service_interest field MUST be the FULL EXACT service name from [SERVICES_LIST], character-for-character (or at minimum a verbatim substring that only matches ONE service in the catalog). Never shorten it, never paraphrase it, never extract a partial phrase like "full set", "the classic one", "the longer one", "the manicure". If the customer confirms a partial phrase like "full set" but the conversation state's selected_service is already locked to "Nail Art Full Set", keep selected_service as "Nail Art Full Set" — don't replace it with a fuzzy match. The booking layer refuses partial phrases; better to lock to the exact name yourself.
- **Service-not-offered rule:** if the customer's request is NOT in {{SERVICES_LIST}} at all (e.g. they ask for a haircut at a nail bar, or for any service you don't carry), do NOT offer time slots. Set intent='other' and reply: "Sorry, we don't offer [X] at {{SALON_NAME}}. We do offer: [list every service from {{SERVICES_LIST}}]. Want to book one of these instead?"
- Only UPDATE a slot in CONVERSATION_STATE when the customer gives new info for that specific slot. Everything else stays.
- Never silently drop a slot that's already filled. If you're missing only the phone number, ask ONLY for the phone number — don't re-ask for the service or date.

## 3. Date and time — must be exact, every time (CRITICAL)

Bugs like telling a customer a future time "has already passed" are unacceptable. Follow this procedure on every time-related message:

1. Read {{CURRENT_DATETIME_PKT}} fresh — this is the real current date+time in PKT. Do not estimate, do not carry over a guess.
2. When the customer requests a time:
   - Combine requested_date + requested_time into a single datetime.
   - Compare it directly against {{CURRENT_DATETIME_PKT}}.
   - It is only "in the past" if that combined datetime is STRICTLY EARLIER than {{CURRENT_DATETIME_PKT}}.
   - Any time on a FUTURE date (tomorrow, next week, etc.) is NEVER in the past. If requested_date ≠ today's date, the "already passed" check does not apply.
3. If asked what the current time/date is, state {{CURRENT_DATETIME_PKT}} plainly. Never invent a different time.
4. Check the requested time against {{SALON_HOURS}} for that specific day-of-week before confirming — reject only if it's outside operating hours OR the slot is already booked, and say which.
5. If a time genuinely has passed (same day, earlier than now), say so ONCE, and immediately offer the next available slot — don't repeat the same rejection verbatim.

## 4. Booking flow

1. Identify the service from {{SERVICES_LIST}} — never invent one.
2. Confirm service name + price + duration back to the customer.
3. Get date + time, validated per Section 3.
4. Get name and phone if not already in {{CONVERSATION_STATE}}.
5. Give one final confirmation summary: service, price, date, time, name, phone.
6. After the customer confirms, set reply_text to indicate the system will request the slot (use "I will request", "let me submit this", "salon will confirm shortly" — NEVER "booked", "confirmed", "set", "scheduled"). Only the system can mark a booking as final.
7. If any required detail is missing, ask for ONLY that detail — one question at a time.

## 5. FAQs

Answer directly from {{SERVICES_LIST}} and {{SALON_HOURS}} — prices, durations, service types, opening hours, location. If something isn't in the provided data, say you'll check and get back — never guess a price or make up a service.

## 6. Escalation

If the customer is upset, asks for a refund, complains about staff, or asks something outside booking/FAQ scope, set intent="complaint" and tell them a team member will follow up shortly. Do NOT try to resolve it yourself.

## 7. {{AI_RULES}} — owner overrides

If {{AI_RULES}} is non-empty, treat every line as a binding owner instruction (e.g. "Always offer 10% off on Tuesdays", "Never book more than 3 clients per stylist per day"). These override any conflicting default behavior above.

---

## Hard rules — never violate

- NEVER switch the booked service without the customer explicitly asking to switch.
- NEVER shorten, paraphrase, or extract a partial phrase for the service_interest field — use the full exact service name from [SERVICES_LIST].
- NEVER offer a time slot for a service the customer asked for that is NOT in {{SERVICES_LIST}}. Decline first, suggest alternatives from the catalog.
- NEVER repeat "that time has already passed" for a future date.
- NEVER re-greet with "Salaam" more than once per conversation.
- NEVER use more than one emoji in a single message.
- NEVER fabricate a service, price, or slot not present in {{SERVICES_LIST}} / {{SALON_HOURS}}.
- NEVER ask for information the customer already gave earlier in this conversation.
- NEVER invent the current date or time — read {{CURRENT_DATETIME_PKT}}.

---

## OUTPUT FORMAT — every reply MUST be a JSON object with EXACTLY these fields:

{
  "intent": one of: "greeting" | "price_inquiry" | "book" | "reschedule" | "cancel" | "hours_inquiry" | "directions" | "complaint" | "other",
  "service_interest": string or null — name of the service the customer is asking about. Must match or be close to one of the services in {{SERVICES_LIST}}. If the conversation already has a selected_service in {{CONVERSATION_STATE}} and the customer hasn't switched, return that same value here.
  "preferred_date": string or null — ISO date YYYY-MM-DD. Resolve "tomorrow", "kal", "next Monday" relative to {{CURRENT_DATETIME_PKT}}, NOT to your training data.
  "preferred_time": string or null — 24-hour HH:MM (e.g. "3pm" → "15:00", "subah 10 baje" → "10:00").
  "customer_name": string or null — if the customer shared their name in this conversation (check {{CONVERSATION_STATE}} first — don't ask again for a name already known).
  "customer_phone": string or null — if the customer shared their phone.
  "reply_text": the actual message to send to the customer (1-3 sentences, warm and conversational, ≤1 emoji, no corporate phrasing).
  "confidence": number 0-100 — how confident you are in the structured fields. Use 90+ only when intent + service + date + time are all clear.
}`;

/**
 * Build the per-business system prompt by appending the salon's real data
 * (services, hours, staff count), the current PKT datetime, and the
 * structured conversation state.
 *
 * The context may be partial (owner hasn't set everything up yet) — the
 * resulting prompt explicitly tells the LLM what's missing so it can
 * gracefully degrade.
 *
 * The {{...}} placeholders in BASE_PROMPT are filled in here so the LLM
 * sees real values, not template tokens.
 */
function buildSystemPrompt(
  ctx: SalonContext,
  conversationStatePrompt?: string
): string {
  // ------------------------------------------------------------------
  // 1. Fill the placeholders in BASE_PROMPT with real per-turn data.
  // ------------------------------------------------------------------
  const servicesBlock = ctx.is_configured
    ? ctx.services
        .map((s) => {
          const price = s.price != null ? `PKR ${s.price}` : 'price on request';
          return `- ${s.name} — ${s.duration_minutes} min — ${price}`;
        })
        .join('\n')
    : '(NOT YET CONFIGURED — the salon owner has not added their menu yet. If a customer asks about services or prices, say "The salon is still setting up our menu. Let me have the owner share our full list with you shortly.")';

  const hoursBlock = ctx.hours.length > 0
    ? ctx.hours
        .map((h) => {
          if (!h.is_open) return `- ${h.day_of_week}: closed`;
          return `- ${h.day_of_week}: ${h.open_time}–${h.close_time}`;
        })
        .join('\n')
    : '(no hours configured)';

  const stateBlock = (conversationStatePrompt && conversationStatePrompt.trim())
    ? conversationStatePrompt
    : '## Conversation state\n(no state yet — first message in this conversation)';

  const rulesBlock = ctx.ai_rules && ctx.ai_rules.trim()
    ? ctx.ai_rules.trim()
    : '(no owner rules set)';

  const cityLine = ctx.city ? `\nLocation: ${ctx.city}` : '';
  const staffLine = `Staff: ${ctx.staff_count} active${ctx.is_configured ? '' : ' (but no services yet)'}`;

  const filled = BASE_PROMPT
    .replaceAll('{{SALON_NAME}}', ctx.name)
    .replaceAll('{{SERVICES_LIST}}', servicesBlock)
    .replaceAll('{{SALON_HOURS}}', hoursBlock)
    .replaceAll('{{CURRENT_DATETIME_PKT}}', `${ctx.current_datetime_pkt} (today is ${ctx.today_pkt})`)
    .replaceAll('{{CONVERSATION_STATE}}', stateBlock)
    .replaceAll('{{AI_RULES}}', rulesBlock);

  // ------------------------------------------------------------------
  // 2. Append salon header (location/timezone) + extras that don't
  //    fit the placeholder model.
  // ------------------------------------------------------------------
  const lines: string[] = [
    filled,
    '',
    '---',
    '',
    `## Salon header`,
    `Name: ${ctx.name}${cityLine}`,
    `Timezone: ${ctx.timezone}`,
    staffLine,
    '',
  ];

  return lines.join('\n');
}

interface GenerateReplyOptions {
  customerMessage: string;
  salonContext: SalonContext;
  /**
   * Formatted markdown block describing the conversation's structured state.
   * Replaces the old message-history list as source of truth.
   */
  conversationStatePrompt?: string;
}

export async function generateReply({
  customerMessage,
  salonContext,
  conversationStatePrompt,
}: GenerateReplyOptions): Promise<GenerateReplyResult> {
  try {
    const systemPrompt = buildSystemPrompt(salonContext, conversationStatePrompt);

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: customerMessage },
    ];

    const response = await axios.post(
      API_URL,
      {
        model: MODEL,
        // Bumped from 800 → 1500 because we've observed MiniMax
        // truncate mid-JSON on long system prompts (full services +
        // hours + state), leaving "preferred_time": "15:" — which our
        // parser then leaks to the customer as the bot reply.
        max_tokens: 1500,
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const rawContent: string =
      response.data?.choices?.[0]?.message?.content || '';

    // Strip any <think> reasoning blocks (some models emit them inline).
    const cleaned = rawContent
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();

    const parsed = parseStructuredReply(cleaned);
    return parsed;
  } catch (error: any) {
    console.error('LLM call failed:', error.response?.data || error.message);
    return FALLBACK_RESULT;
  }
}

// ---------------------------------------------------------------------------
// Parsing — extract the JSON object from whatever the LLM produced.
//
// Models sometimes wrap JSON in markdown fences (```json ... ```) or add
// preamble text. We strip both, then JSON.parse. On any failure we log +
// return the FALLBACK so the bot still replies.
// ---------------------------------------------------------------------------

function parseStructuredReply(raw: string): GenerateReplyResult {
  if (!raw) return FALLBACK_RESULT;

  // Try the whole string first.
  const direct = tryParseJson(raw);
  if (direct) return normalizeResult(direct, raw);

  // Strip markdown code fences if present.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inner = tryParseJson(fenced[1]);
    if (inner) return normalizeResult(inner, raw);
  }

  // Last resort: find the first {...} block in the string.
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const inner = tryParseJson(raw.substring(firstBrace, lastBrace + 1));
    if (inner) return normalizeResult(inner, raw);
  }

  // All JSON-parsing paths failed. We have two possibilities:
  //   (a) The LLM returned plain conversational text (no JSON at all) —
  //       use it as the reply because it's legitimate.
  //   (b) The LLM returned truncated/malformed JSON — DO NOT send that
  //       garbage to the customer. We've seen customers receive things
  //       like `{"intent": "book", "preferred_time": "15:` as their bot
  //       reply, which is unacceptable.
  const looksLikeJson = raw.trimStart().startsWith('{') || raw.includes('```');
  if (looksLikeJson) {
    console.warn(
      '[llm] malformed/truncated JSON from model — using FALLBACK reply. raw[:200]=',
      raw.slice(0, 200)
    );
    return FALLBACK_RESULT;
  }

  console.warn(
    '[llm] could not parse structured output (non-JSON). Using raw as reply. raw=',
    raw.slice(0, 200)
  );
  return {
    ...FALLBACK_RESULT,
    reply: raw.trim() || FALLBACK_RESULT.reply,
  };
}

function tryParseJson(s: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

function normalizeResult(
  obj: Record<string, unknown>,
  raw: string
): GenerateReplyResult {
  const intent = clampIntent(obj.intent);
  const reply = sanitizeReply(obj.reply_text);

  return {
    reply,
    intent,
    service_interest: typeof obj.service_interest === 'string'
      ? obj.service_interest
      : null,
    preferred_date: typeof obj.preferred_date === 'string'
      ? obj.preferred_date
      : null,
    preferred_time: typeof obj.preferred_time === 'string'
      ? obj.preferred_time
      : null,
    customer_name: typeof obj.customer_name === 'string'
      ? obj.customer_name
      : null,
    customer_phone: typeof obj.customer_phone === 'string'
      ? obj.customer_phone
      : null,
    confidence: clampConfidence(obj.confidence),
  };
}

const VALID_INTENTS: ReadonlySet<BotIntent> = new Set([
  'greeting',
  'price_inquiry',
  'book',
  'reschedule',
  'cancel',
  'hours_inquiry',
  'directions',
  'complaint',
  'other',
]);

function clampIntent(raw: unknown): BotIntent {
  if (typeof raw === 'string' && VALID_INTENTS.has(raw as BotIntent)) {
    return raw as BotIntent;
  }
  return 'other';
}

function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sanitizeReply(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return FALLBACK_RESULT.reply;
  }
  // Strip any <think> blocks that survived parsing.
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}