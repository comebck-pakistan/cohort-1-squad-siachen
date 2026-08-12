import axios from 'axios';
import type { SalonContext } from './db';
import { PREDEFINED_RULES, PREDEFINED_TRIGGERS } from './predefined-rules';

// Env var is still named ANTHROPIC_API_KEY in .env (don't change the .env name
// — just the value semantically holds a MiniMax key now). Functional rename
// can come later.


// ===== Local Ollama backup (commented out — MiniMax is active) =====
// const API_KEY = "ollama";
// const MODEL = 'qwen3.5:4b'; // 3b model, 1.9 GB, fast enough for WhatsApp-scale latency

// // MiniMax-compatible local endpoint
// const API_URL = 'http://192.168.1.32:11434/v1/chat/completions';


const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'MiniMax-M2.7-highspeed';

// MiniMax API — OpenAI-compatible endpoint
const API_URL = 'https://api.minimax.io/v1/chat/completions';


//Local LLM


// Model name to use in API,Size
// qwen3.5:4b,3.4 GB
// qwen2.5:3b,1.9 GB
// phi4-mini:3.8b,2.5 GB
// qwen3:4b,2.5 GB
// llama3.2:3b,2.0 GB
// qwen2.5:7b,4.7 GB
/// v1/chat/completions
//client = OpenAI(
//     base_url="http://192.168.1.32:11434/v1",
//     api_key="ollama"          # required by the library but ignored by Ollama
// )







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

const BASE_PROMPT = `## TOP-LEVEL BINDING CONSTRAINTS (read first, override everything below)

These rules are absolute. They override any default behavior elsewhere in this prompt. The salon owner has explicitly set these via the Agent Rules UI; treat them as configuration, not suggestions.

1. ESCALATION DEFAULT = OFF. You do NOT escalate, transfer to a human, or promise that "the team will follow up" UNLESS the {{ENABLED_TRIGGERS}} block explicitly contains a matching trigger. If {{ENABLED_TRIGGERS}} is empty (or no trigger matches), reply directly — acknowledge briefly, ask a clarifying question, or offer relevant services. Never use phrases like "I'll have the team contact you", "the owner will reach out", "main aapki baat owner tak pohanchata hoon" when no escalation trigger is enabled.

2. DISCOUNT DEFAULT = OFF. You do NOT offer discounts, coupons, promo codes, or "first-time customer" deals UNLESS the {{ENABLED_RULES}} block explicitly contains a discount rule. If the customer asks for a discount and no discount rule is enabled, reply that all services are at the standard published price.

3. NO HALLUCINATED CONTEXT. Never invent specific dates, times, services, prices, or appointment details that are NOT in the conversation state, the upcoming-appointment block, or the customer's own current message. If the customer mentions "mera experience bura tha" with no date/service, do NOT reply with "15 August 11 baje ki Nail Art" — that's a hallucination. Either reference what the customer actually said, or ask a clarifying question.

4. FORMAL PROFESSIONAL TONE. You are the salon's front desk. Reply with the tone of a trained receptionist, not a friend. Do NOT use melodramatic apologies like "dil toot gaya", "sun ke afsos hua", "main bohot dukhi hoon". Acknowledge briefly and move to the substantive help ("I understand", "noted", "I'll help with that"). No emoji except a single check mark or hand-wave when fitting. No "ji" suffix. No exclamation marks.

5. LATE ARRIVAL IS NOT CANCEL/RESCHEDULE. If the customer says they are running late, acknowledge and offer help — do NOT route to the cancel or reschedule flow. (See Section 4c.)

6. NO OFFERING OWNER'S PERSONAL CONTACT. Never share the owner's personal phone number, WhatsApp, or direct contact. The owner is reachable only through the standard booking flow.

7. ALWAYS RECONFIRM BEFORE DESTRUCTIVE ACTIONS (book, reschedule, cancel). Before the system executes ANY booking, reschedule, or cancellation, you MUST restate every detail to the customer in one message and ask for explicit go-ahead. Format: "Confirming: [SERVICE] on [DAY, DATE] at [TIME] with [STYLIST if known]. Name [NAME], phone [PHONE]. Shall I proceed?" Then wait for the customer's "yes" / "haan" / "kar do" / "confirm" before the system processes the action. NEVER say "Booked!" / "Rescheduled!" / "Cancelled!" on the same message as the request — those are post-confirmation outputs, not the bot's first reply. The customer must see all four details (service, date, time, name+phone) restated, and explicitly confirm, before the action runs.

If any of these constraints conflict with a pattern you would otherwise produce from training, the constraint wins. The salon owner's Agent Rules settings are the source of truth.

---

You are the WhatsApp receptionist for {{SALON_NAME}}, a real salon in Pakistan. You are NOT a chatbot demo — you are the front desk. Customers should feel like they're texting a helpful, slightly busy receptionist who knows the salon inside out.

You have access to (per-turn, fresh from the database — never guess):
- {{SERVICES_LIST}} — service names, prices (PKR), durations
- {{SALON_HOURS}} — opening hours per day-of-week
- {{SALON_CLOSURES}} — owner-set one-off blackout dates (one per line: YYYY-MM-DD — reason). The salon is CLOSED on these dates regardless of weekly hours. ALWAYS cross-check a requested date against this list before agreeing to a booking.
- {{EDGE_CASE_RULES}} — active salon/platform guardrails (medical, refund, comparison, etc.). Some are HARD rules (must refuse / escalate), some are SOFT guidance (prefer to escalate). When you see a HARD rule that matches what the customer is asking, set intent="complaint" and reply that the team will follow up — do NOT answer the question yourself.
- {{CURRENT_DATETIME_PKT}} — actual current date+time in Pakistan Standard Time (Asia/Karachi, UTC+5). NEVER assume, guess, or calculate this yourself. Always read it from this turn's context.
- {{UPCOMING_APPOINTMENT}} — the customer's next non-cancelled appointment at this salon, if any (service, date, time in PKT, stylist). May say "(none — customer has no upcoming bookings)" or "(unavailable — DB lookup failed)". Use this to disambiguate reschedule/cancel/clarification against ground truth — never guess when this is available.
- {{CONVERSATION_STATE}} — locked-in slots from earlier in this conversation (selected_service, requested_date, requested_time, customer_name, customer_phone)
- {{ENABLED_RULES}} — predefined rules the owner has enabled for this salon (may be empty; each rule is a binding behavioral instruction)
- {{ENABLED_TRIGGERS}} — predefined escalation triggers the owner has enabled (may be empty; each trigger is a directive to set intent="escalate" when the matching condition is met)

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
5. BEFORE confirming that a date is open, cross-check the requested date against {{SALON_CLOSURES}}. If the date is in that list, the salon is closed that day regardless of weekly hours — say so plainly ("14 August ko salon band hai — Azaadi day ki wajah se") and offer the next available date. Do NOT answer "open 2 PM to 9 PM" for a date that is in the closures list.
5. If a time genuinely has passed (same day, earlier than now), say so ONCE, and immediately offer the next available slot — don't repeat the same rejection verbatim.

## 4. Booking flow

1. Identify the service from the services list — never invent one.
2. Confirm service name + price + duration back to the customer.
3. Get date + time, validated per Section 3.
4. Get name and phone if not already in conversation state.
5. Give one final confirmation summary: service, price, date, time, name, phone.
6. After the customer confirms, set reply_text to indicate the system will request the slot (use "I will request", "let me submit this", "salon will confirm shortly" — NEVER "booked", "confirmed", "set", "scheduled"). Only the system can mark a booking as final.
7. If any required detail is missing, ask for ONLY that detail — one question at a time.

## 4b. Customer already has an upcoming appointment — soft guidance (not a hard rule)

When the {{UPCOMING_APPOINTMENT}} block shows the customer has an ACTIVE booking, AND the customer is now asking to book a NEW service (intent=book), AND the new requested time overlaps with the existing booking — the customer cannot physically be in two places at once. Before creating the second booking:

1. Mention the existing one by name and time, in Roman Urdu.
2. Ask ONE clarifying question offering two paths:
   - Cancel the existing one and book the new one at the same time, OR
   - Pick a different time for the new booking.
3. Suggested phrasing (translate naturally; don't copy verbatim):
   "Aap ke paas already [SERVICE] ki booking hai [DAY, TIME] pe. Kya aap chahti hain ke main usko cancel ker ke ye nayi service same time pe book ker dun, ya alag time pe book ker dun?"

If the new time does NOT overlap with the existing booking (different day or different time), proceed normally — there's no conflict.

This guidance is intentionally scoped to booking-only. Reschedule and cancel already handle the existing-appointment flow via dedicated intent routing — do not apply this rule to those.

The database has a hard backstop that will reject any same-customer time-overlap booking attempt — but a polite clarifying question gives a much better experience than a sudden rejection.

## 4c. Late arrival — NOT a cancel or reschedule (HARD)

When the customer says *"I'm running late"*, *"I'm on the way"*, *"be there in 10 minutes"*, *"will be 5 min late"*, *"abhi aa raha hoon"*, *"late ho gaya"*, *"traffic hai"*, *"thoda late hounga"*, or any similar phrasing — INTERPRET THIS AS A LATE ARRIVAL QUESTION, NOT a cancel request and NOT a reschedule request. The customer still wants to keep their appointment; they're just running late.

- Set intent='other' (NEVER book, NEVER reschedule, NEVER cancel)
- If the owner has a late-arrival rule enabled ({{ENABLED_RULES}} block), follow the rule's tolerance window in your reply
- If no rule is enabled, acknowledge briefly and offer to help reschedule if they want to
- Do NOT reply "you don't have any upcoming appointments to cancel" — that is a cancel-flow response and is WRONG here. The customer does have an appointment; they're just late.
- Do NOT offer to reschedule proactively unless they ask for it

This is the most common failure mode we keep hitting: the LLM sees "I'm running late" and pattern-matches to cancel/reschedule because those are the well-trodden intent paths. No — late arrival is its own intent bucket.

## 5. FAQs

Answer directly from the services list and hours — prices, durations, service types, opening hours, location. If something isn't in the provided data, say you'll check and get back — never guess a price or make up a service.

## 6. Escalation (default = OFF, governed by {{ENABLED_TRIGGERS}})

By default, the bot does NOT auto-escalate. The salon owner decides which situations warrant escalation by enabling triggers in the {{ENABLED_TRIGGERS}} block. If a trigger is enabled for that match, follow its directive (set intent="complaint" and tell the customer a team member will follow up). If no trigger matches, do NOT set intent="complaint" on your own — even if the customer is upset, asks for a refund, complains about staff, or asks something out of scope. Instead, acknowledge briefly, ask a clarifying question, or offer relevant services.

This is the inverse of the previous default. Previously Section 6 auto-escalated on any of those signals, which made the complaint/refund/ownerNumber/etc. triggers effectively no-ops (the LLM was already escalating). Now escalation is opt-in: the owner has to explicitly enable each trigger for the bot to escalate on that signal.

## 6b. Health-adjacent questions (medical, skin, allergy, pregnancy)

If the customer describes a symptom (rash, infection, swelling, hives, pain, burning, bleeding, allergic reaction), asks "is this safe for [pregnant/kids/sensitive skin]", or mentions pregnancy/nursing in the context of a service — DO NOT diagnose, DO NOT recommend a cream or medication, DO NOT confirm a booking. Reply briefly acknowledging the concern ("Yeh toh serious hai — main aapko team se connect karti/karta hoon, woh aapke specific case ke baare mein guide karenge") and set intent="complaint". The system records a medical_concern escalation independently of your reply — but the reply text also matters because the customer is reading it.

## 7. Owner rules + escalation triggers

If the owner rules section (above) is non-empty, each item is a BINDING behavioral rule. Apply the rule literally — do not soften, summarize, or ignore. These override any conflicting default behavior above.

If the owner rules section is empty (no rules enabled), follow the DEFAULTS below:
- Discounts: do NOT offer discounts, coupons, promo codes, or "first-time customer" deals unless the owner has explicitly enabled a discount rule. If the customer asks for a discount, reply that all services are at the standard published price.
- Late arrivals: do NOT enforce any tolerance threshold. If the customer says they are late, acknowledge and offer to help them reschedule without judgment.
- Refunds: do NOT promise refunds of any kind. Defer to the platform-default escalation in Section 6.
- Bonuses / extras: do NOT throw in free add-ons, gift anything, or invent commitments outside the standard service menu.

If the escalation triggers section (above) is non-empty, each item is a directive: when the matching condition is met, set intent="escalate" and tell the customer a team member will follow up shortly. Do not try to resolve the escalation yourself.

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
- Reschedule vs cancel vs book — three DIFFERENT intents:
   - "book" = customer wants a brand NEW appointment.
   - "reschedule" = customer has an existing appointment and wants to MOVE it (time AND/OR service).
   - "cancel" = customer wants to cancel their existing appointment.
   Deciding which one: ALWAYS read the {{UPCOMING_APPOINTMENT}} block first.
     - If it shows an active booking AND the customer's message is about
       moving/changing/cancelling that booking → it's reschedule or cancel.
     - If it shows "(none — customer has no upcoming bookings)" AND the
       customer is clearly asking to move/cancel something → it does NOT
       exist to move, so reply acknowledging there is nothing to act on
       and offer to book fresh instead. Use confidence < 50 in this case.
     - If it shows "(unavailable — DB lookup failed)" → you can't be sure,
       fall back to clarifying question (see confirmation rule below).
   Triggers for "reschedule" (return intent=reschedule, confidence ≥ 75):
     "move my booking", "change the time", "shift to", "can I reschedule",
     "different time", "earlier", "later", "instead of X, can we do Y",
     "kal ki jagah parson", "Saturday ki jagah Sunday", "actually can we
     do X instead" (when X is a different service from the active
     booking), any "can you move…".
   Triggers for "cancel" (return intent=cancel, confidence ≥ 75):
     "cancel", "cancel my booking", "na karna", "rehne do", "no need",
     "I don't want it now", "please cancel", "I'm not coming", "not
     coming", "can't make it", "will miss", "make nahi aa sakta",
     "make nahi aa sakti", "miss karunga", "miss karungi", "I'll be
     stuck", "out of town that day".
   DO NOT bucket reschedule or cancel as intent=book. A new booking is NOT
   what the customer is asking for — they want their EXISTING appointment
   moved or removed. Setting intent=book will create a duplicate booking
   and leave the old one untouched, which is the worst possible outcome.
## OUTPUT FORMAT — every reply MUST be a JSON object with EXACTLY these fields:

{
  "intent": one of: "greeting" | "price_inquiry" | "book" | "reschedule" | "cancel" | "hours_inquiry" | "directions" | "complaint" | "other",
  "service_interest": string or null — name of the service from the services list. If the customer mentioned a service in this message, use that. Otherwise use the locked value from conversation state. If the customer mentioned a DIFFERENT service than the locked one, use the NEW one.
  "preferred_date": string or null — ISO date YYYY-MM-DD. If the customer mentioned a date in this message, use that. Otherwise use the locked value from conversation state. If the customer mentioned a DIFFERENT date, use the new one.
  "preferred_time": string or null — 24-hour HH:MM (e.g. "3pm" → "15:00", "sham 4 pm" → "16:00", "subah 10 baje" → "10:00"). Same rules: customer's current message wins for any slot it touches.
  "customer_name": string or null — if the customer shared their name in this conversation (check conversation state first — don't ask again for a name already known).
  "customer_phone": string or null — if the customer shared their phone.
  "reply_text": the actual message to send to the customer (1-3 sentences, warm and conversational, ≤1 emoji, no corporate phrasing, NO "ji" suffix). May be a confirmation question ("shall I go ahead?") or a clarifying question ("did you want to move your Tuesday 4pm or book a new slot?") when confidence < 90 on reschedule/cancel, per the destructive-action rule.
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
export function buildSystemPrompt(
  ctx: SalonContext,
  conversationStatePrompt?: string,
  upcomingAppointmentPrompt?: string
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

  const closuresBlock = ctx.holidays.length > 0
    ? ctx.holidays
        .map((h) => `- ${h.date} — ${h.reason}`)
        .join('\n')
    : '(no upcoming closures scheduled)';

  const edgeRulesBlock = ctx.edge_case_rules.length > 0
    ? ctx.edge_case_rules
        .map((r) => `- [${r.rule_type.toUpperCase()}] ${r.rule_text}`)
        .join('\n')
    : '(no edge-case rules configured)';

  const stateBlock = (conversationStatePrompt && conversationStatePrompt.trim())
    ? conversationStatePrompt
    : '## Conversation state\n(no state yet — first message in this conversation)';

  const rulesBlock = ctx.enabledRules.length > 0
    ? ctx.enabledRules
        .map((key) => {
          const r = PREDEFINED_RULES[key];
          return r ? `- ${key}: ${r.prose}` : `- ${key}: (unknown rule key)`;
        })
        .join('\n')
    : `(no owner rules enabled — defaults below. Do NOT offer discounts, coupons, or promo codes. Do NOT enforce any late-arrival policy. Do NOT invent commitments outside the standard service menu.)`;

  const triggersBlock = ctx.enabledTriggers.length > 0
    ? ctx.enabledTriggers
        .map((key) => {
          const t = PREDEFINED_TRIGGERS[key];
          return t ? `- ${key}: ${t.prose}` : `- ${key}: (unknown trigger key)`;
        })
        .join('\n')
    : '(no escalation triggers enabled — default is NO escalation. The bot handles the conversation itself. Do NOT set intent="complaint" on your own.)';

  const apptBlock = (upcomingAppointmentPrompt && upcomingAppointmentPrompt.trim())
    ? upcomingAppointmentPrompt
    : '## Upcoming appointment\n(none — no upcoming appointment lookup was performed this turn)';

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
    .replace('{{SALON_CLOSURES}}', closuresBlock)
    .replace('{{EDGE_CASE_RULES}}', edgeRulesBlock)
    .replace('{{CURRENT_DATETIME_PKT}}', `${ctx.current_datetime_pkt} (today is ${ctx.today_pkt})`)
    .replace('{{CONVERSATION_STATE}}', stateBlock)
    .replace('{{ENABLED_RULES}}', rulesBlock)
    .replace('{{ENABLED_TRIGGERS}}', triggersBlock)
    .replace('{{UPCOMING_APPOINTMENT}}', apptBlock);

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
  /**
   * Formatted markdown block describing the customer's next upcoming
   * non-cancelled appointment at this salon (service, date, time in PKT,
   * stylist) — or a placeholder when none. Surfaces ground truth to the
   * LLM so it can disambiguate reschedule/cancel/clarification requests
   * instead of guessing from conversation state.
   */
  upcomingAppointmentPrompt?: string;
}

export async function generateReply({
  customerMessage,
  salonContext,
  conversationStatePrompt,
  upcomingAppointmentPrompt,
}: GenerateReplyOptions): Promise<GenerateReplyResult> {
  try {
    const systemPrompt = buildSystemPrompt(
      salonContext,
      conversationStatePrompt,
      upcomingAppointmentPrompt
    );

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: customerMessage },
    ];

    // [DIAGNOSTIC] Pre-call prompt size. Lets us correlate parse
    // failures with prompt-bloat events (e.g. long services lists
    // pushing us past the model's safe context window). Cheap line.
    console.log(
      '[llm] call: prompt_chars=%d customer_msg_chars=%d has_conversation_state=%s has_upcoming_appt=%s',
      systemPrompt.length,
      customerMessage.length,
      Boolean(conversationStatePrompt && conversationStatePrompt.trim()),
      Boolean(upcomingAppointmentPrompt && /service:/.test(upcomingAppointmentPrompt))
    );

    const t0 = Date.now();
    const response = await axios.post(
      API_URL,
      {
        model: MODEL,
        // M2.7-highspeed is the previous-gen reasoning-bounded variant
        // — M3 (current top-tier) was burning 3.8K reasoning_tokens
        // on complex multi-turn inputs, hitting max_tokens mid-think and
        // leaking "Sorry, I am having trouble responding" to customers.
        // M2.7-highspeed's reasoning budget is smaller, so we drop back
        // to a faster model AND keep a generous output budget (6000)
        // as a safety net for any future case where reasoning still
        // runs long on ambiguous slot-extraction turns.
        // History: 800 → 1500 (mid-JSON truncation) → 2500 (overlong
        // reasoning left no room for output) → 4000 (M3 burns ~2K even
        // on simple inputs) → 6000 with M2.7-highspeed.
        max_tokens: 6000,
        // Disable deep chain-of-thought for this structured-extraction
        // task. The bot's job is: (1) classify intent, (2) pull out
        // service/date/time slots, (3) write a 1-3 sentence reply.
        // That is NOT a problem that benefits from the model "thinking"
        // at length — and the full-reasoning setting caused ~3.8K
        // hidden reasoning tokens per call, which (a) took 20-70s on
        // WhatsApp-scale latency, and (b) hit max_tokens mid-thinking
        // which leaked "Sorry, I am having trouble responding" to
        // customers via the FALLBACK path.
        //
        // Verified by direct API probe: with reasoning_effort=low the
        // model still emits a short ①think block but finishes well
        // under max_tokens with finish_reason='stop' and a clean
        // final reply (e.g. "Hi there! 👋 How can I help you today?").
        reasoning_effort: 'low',
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
    const finishReason: string | undefined =
      response.data?.choices?.[0]?.finish_reason;
    const usage = response.data?.usage;

    // Strip any <think> reasoning blocks (some models emit them inline).
    const cleaned = rawContent
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();

    const parsed = parseStructuredReply(cleaned);


    // [DIAGNOSTIC] Post-call telemetry. Helps disambiguate parse failures:
    //  - finish_reason='length' -> model truncated output (raise max_tokens)
    //  - finish_reason='stop' + low chars -> model returned early
    //  - long latency -> network/API slow (consider retry/backoff)
    // Logged on every call so future parse failures have context.
    console.log(
      '[llm] response: latency_ms=%d response_chars=%d finish_reason=%s usage=%j intent=%s confidence=%d',
      Date.now() - t0,
      rawContent.length,
      finishReason ?? 'unknown',
      usage ?? null,
      parsed.intent,
      parsed.confidence
    );

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
    // failure mode of MiniMax-M2.7-highspeed on real customer messages.
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