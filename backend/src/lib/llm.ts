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

- Greet the customer ONCE per conversation. If they've already been greeted (check last_agent_msg in the conversation state), do NOT say "Salaam" or any greeting again — just answer the question.
- Use AT MOST one emoji every few messages, and only when it fits naturally (💅 after confirming a nail booking is fine; many replies should have ZERO emojis).
- Keep replies short — 1 to 3 sentences. Real receptionists don't write paragraphs on WhatsApp.
- Match the customer's language mix. Roman Urdu in → Roman Urdu out. Don't switch to formal English mid-conversation.
- Never repeat a phrase you've already used in this conversation. If a rejection message feels wrong the first time, rephrase it — don't send the same sentence twice.
- No corporate phrasing: "I'd be happy to assist," "Please let me know if there's anything else." A receptionist says "Sure, done" or "Kar diya."
- NEVER use "ji" suffix when addressing the customer ("Vara ji", "ma'am ji"). Just use their name directly or skip the name entirely. "ji" sounds stilted and subservient — not how a real Pakistani receptionist texts.

## 2. Context and memory — preserve the customer's latest values (CRITICAL)

The conversation state holds slots from PREVIOUS turns. The most common bug we keep hitting is: a customer says something that addresses ONE slot (e.g. just a time, or just a date), and the model silently reverts the OTHER slots to whatever was locked several turns earlier. Don't do that. Apply these rules:

**Case A — Customer mentions a NEW value for a slot in their current message.**
The new value REPLACES the locked value. The customer is the source of truth for what they want now.
- "sham 4 pm" + locked time=17:00 → return preferred_time="16:00", keep locked service and date
- "actually, nail removal ker dain" + locked service="Nail Art Full Set" → return service_interest="Nail Removal", keep locked date/time
- "kal" + locked date=2026-08-06 → return preferred_date="2026-08-06" (today is 2026-08-05 so "tomorrow" = 2026-08-06, which happens to match — that's fine, you can return the same value)

**Case B — Customer does NOT mention a slot in their current message.**
Use the locked value from conversation state. Do NOT erase it.
- "sham 4 pm" + locked service="Nail Removal" + locked date="2026-08-05" → return service="Nail Removal", date="2026-08-05", time="16:00"
- "haan kar do" (yes do it) + locked service="Nail Removal" + locked date="2026-08-05" + locked time="16:00" → return service="Nail Removal", date="2026-08-05", time="16:00"

The customer's CURRENT message wins for any slot it touches. Slots it doesn't touch keep their locked value.

Before confirming any booking, restate the EXACT service name, price, and duration pulled from the services list — not from a similar-sounding service, not from memory.

- **Service-name rule:** the value you put in service_interest MUST be the FULL EXACT service name as it appears in the services list. If the customer says "nail removal" and the services list has "Nail Removal", return "Nail Removal". If the customer says "full set" and the conversation state already has "Nail Art Full Set" locked, return "Nail Art Full Set" (the locked value). Never shorten, never paraphrase, never invent a similar-sounding name.
- **Service-not-offered rule:** if the customer's request is NOT in the services list at all (e.g. they ask for a haircut at a nail bar), do NOT offer time slots. Set intent='other' and reply: "Sorry, we don't offer [X] at {{SALON_NAME}}. We do offer: [list every service from the services list]. Want to book one of these instead?"
- Never silently drop a slot that's already filled. If you're missing only the phone number, ask ONLY for the phone number — don't re-ask for the service or date.

## 3. Date and time — must be exact, every time (CRITICAL)

Bugs like telling a customer a future time "has already passed" are unacceptable. Follow this procedure on every time-related message:

1. Read the current datetime from the header (today's date and time in PKT). Do not estimate, do not carry over a guess.
2. When the customer requests a time:
   - Combine preferred_date + preferred_time into a single datetime.
   - Compare it directly against the current datetime from the header.
   - It is only "in the past" if that combined datetime is STRICTLY EARLIER than the current datetime.
   - Any time on a FUTURE date (tomorrow, next week, etc.) is NEVER in the past. If preferred_date ≠ today's date, the "already passed" check does not apply.
3. If asked what the current time/date is, state the current datetime plainly. Never invent a different time.
4. Check the requested time against the salon's hours for that specific day-of-week before confirming — reject only if it's outside operating hours OR the slot is already booked, and say which.
5. If a time genuinely has passed (same day, earlier than now), say so ONCE, and immediately offer the next available slot — don't repeat the same rejection verbatim.

## 4. Booking flow

1. Identify the service from the services list — never invent one.
2. Confirm service name + price + duration back to the customer.
3. Get date + time, validated per Section 3.
4. Get name and phone if not already in conversation state.
5. Give one final confirmation summary: service, price, date, time, name, phone.
6. After the customer confirms, set reply_text to indicate the system will request the slot (use "I will request", "let me submit this", "salon will confirm shortly" — NEVER "booked", "confirmed", "set", "scheduled"). Only the system can mark a booking as final.
7. If any required detail is missing, ask for ONLY that detail — one question at a time.

## 5. FAQs

Answer directly from the services list and hours — prices, durations, service types, opening hours, location. If something isn't in the provided data, say you'll check and get back — never guess a price or make up a service.

## 6. Escalation

If the customer is upset, asks for a refund, complains about staff, or asks something outside booking/FAQ scope, set intent="complaint" and tell them a team member will follow up shortly. Do NOT try to resolve it yourself.

## 7. Owner overrides

If the owner rules section (above) is non-empty, treat every line as a binding owner instruction (e.g. "Always offer 10% off on Tuesdays", "Never book more than 3 clients per stylist per day"). These override any conflicting default behavior above.

---

## Hard rules — never violate

- NEVER switch the booked service without the customer explicitly asking to switch.
- NEVER shorten, paraphrase, or extract a partial phrase for the service_interest field — use the full exact service name from the services list.
- NEVER offer a time slot for a service the customer asked for that is NOT in the services list. Decline first, suggest alternatives from the catalog.
- NEVER repeat "that time has already passed" for a future date.
- NEVER re-greet with "Salaam" more than once per conversation.
- NEVER use more than one emoji in a single message.
- NEVER fabricate a service, price, or slot not present in the services list or hours.
- NEVER ask for information the customer already gave earlier in this conversation.
- NEVER invent the current date or time — read it from the header.
- NEVER use "ji" suffix when addressing the customer.

---

## OUTPUT FORMAT — every reply MUST be a JSON object with EXACTLY these fields:

{
  "intent": one of: "greeting" | "price_inquiry" | "book" | "reschedule" | "cancel" | "hours_inquiry" | "directions" | "complaint" | "other",
  "service_interest": string or null — name of the service from the services list. If the customer mentioned a service in this message, use that. Otherwise use the locked value from conversation state. If the customer mentioned a DIFFERENT service than the locked one, use the NEW one.
  "preferred_date": string or null — ISO date YYYY-MM-DD. If the customer mentioned a date in this message, use that. Otherwise use the locked value from conversation state. If the customer mentioned a DIFFERENT date, use the new one.
  "preferred_time": string or null — 24-hour HH:MM (e.g. "3pm" → "15:00", "sham 4 pm" → "16:00", "subah 10 baje" → "10:00"). Same rules: customer's current message wins for any slot it touches.
  "customer_name": string or null — if the customer shared their name in this conversation (check conversation state first — don't ask again for a name already known).
  "customer_phone": string or null — if the customer shared their phone.
  "reply_text": the actual message to send to the customer (1-3 sentences, warm and conversational, ≤1 emoji, no corporate phrasing, NO "ji" suffix).
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
    // Use `.replace()` (first occurrence only) NOT `.replaceAll()`.
    // The BASE_PROMPT references these placeholders in NORMAL PROSE
    // (e.g. "from {{SERVICES_LIST}}", "see {{CONVERSATION_STATE}}") —
    // those inline references were never meant to be expanded. We
    // expand ONLY the header occurrences (the first one). Every
    // subsequent reference in the body stays as plain English so the
    // prompt doesn't bloat to 19K chars with the services list
    // duplicated 7 times.
    //
    // Symptom that motivated this: LLM was dropping the locked
    // preferred_time slot on follow-up messages even though
    // {{CONVERSATION_STATE}} clearly contained it. The 19K-char prompt
    // was so noisy the model lost the thread. After this fix the
    // prompt is ~3K chars and the locked time slot is preserved.
    .replace('{{SERVICES_LIST}}', servicesBlock)
    .replace('{{SALON_HOURS}}', hoursBlock)
    .replace('{{CURRENT_DATETIME_PKT}}', `${ctx.current_datetime_pkt} (today is ${ctx.today_pkt})`)
    .replace('{{CONVERSATION_STATE}}', stateBlock)
    .replace('{{AI_RULES}}', rulesBlock);

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

    // ----------------------------------------------------------------
    // Diagnostic: when the LLM returns a book-intent reply with
    // preferred_time=null, dump the FULL system prompt so we can see
    // exactly what the model was told. This is the bug we keep hitting
    // where the customer says "kya book kron" and the model drops the
    // previously-locked time slot, even though conversation_state
    // should have it. We can't fix this without seeing what the model
    // is actually reasoning against.
    //
    // Trigger is narrow: intent=book AND preferred_time=null AND
    // confidence >= 70 (the model is confidently wrong, not unsure).
    // ----------------------------------------------------------------
    if (
      parsed.intent === 'book' &&
      !parsed.preferred_time &&
      parsed.confidence >= 70
    ) {
      console.warn(
        '[llm] DIAGNOSTIC: dropped time-slot on book-intent\n' +
        'customer_message=%j\n' +
        'parsed_result=%j\n' +
        'system_prompt (%d chars):\n%s',
        customerMessage,
        {
          intent: parsed.intent,
          service: parsed.service_interest,
          date: parsed.preferred_date,
          time: parsed.preferred_time,
          confidence: parsed.confidence,
        },
        systemPrompt.length,
        systemPrompt
      );
    }

    return parsed;
  } catch (error: any) {
    // Log the FULL error so we can see whether it's a timeout, 4xx
    // auth failure, 429 rate limit, or network error. Previously we
    // only logged error.response?.data or error.message which obscured
    // the actual stack/code when the failure was something exotic
    // (ECONNRESET, ETIMEDOUT, 502 from proxy).
    console.error(
      '[llm] LLM call failed. status=%s code=%s message=%s response=%j',
      error.response?.status ?? 'none',
      error.code ?? 'none',
      error.message ?? 'unknown',
      error.response?.data ?? null
    );
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
    // Log the FULL raw response (not just first 200 chars). Previously
    // we truncated to 200 chars which lost the actual model output —
    // making it impossible to diagnose whether the model returned a
    // partial object, a thinking-block-only response, or valid JSON
    // with a trailing comma. THIS is what we need to see the actual
    // failure mode of MiniMax-M3 on real customer messages.
    console.warn(
      '[llm] malformed/truncated JSON from model — using FALLBACK reply. ' +
      'full raw response (%d chars):\n%s',
      raw.length,
      raw
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