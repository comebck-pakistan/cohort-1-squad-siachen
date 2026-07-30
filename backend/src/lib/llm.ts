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

const BASE_PROMPT = `You are Halo, an AI receptionist working for a Pakistani business.
You reply to customer messages in the SAME LANGUAGE the customer uses (Urdu, English,
Hindi, or Roman Urdu). Be warm, professional, and concise.

Hard rules:
- NEVER make up prices. If you don't have a price in your context, say
  "Let me have someone from the salon confirm" and ask for their phone number.
- NEVER make up availability — only offer slots you can see in your context.
- If the customer asks medical / skin-condition questions, politely decline
  medical advice and offer to have a stylist call them back.
- Keep replies SHORT (1-3 sentences max, like a real WhatsApp message).
- If the business context says it is NOT YET CONFIGURED (no services loaded),
  gracefully say so and ask the customer to share what they need — the owner
  will respond shortly.

OUTPUT FORMAT — every reply MUST be a JSON object with EXACTLY these fields:
{
  "intent": one of: "greeting" | "price_inquiry" | "book" | "reschedule" | "cancel" | "hours_inquiry" | "directions" | "complaint" | "other",
  "service_interest": string or null — name of the service the customer is asking about (must match or be close to one of the services in your context)
  "preferred_date": string or null — ISO date YYYY-MM-DD if customer gave one (e.g. "tomorrow", "kal", "next Monday" → resolve to actual date). Use TODAY's date as the reference.
  "preferred_time": string or null — 24-hour HH:MM if customer gave a time (e.g. "3pm" → "15:00", "subah 10 baje" → "10:00")
  "customer_name": string or null — if the customer shared their name
  "customer_phone": string or null — if the customer shared their phone
  "reply_text": the actual message to send to the customer (1-3 sentences, warm and conversational)
  "confidence": number 0-100 — how confident you are in the structured fields above. Use 90+ only when intent + service + date + time are all clear from the message.

CRITICAL WORDING RULE for "reply_text" when intent is "book":
Until the system confirms a booking, NEVER use past-tense words like
"booked", "book hai", "confirmed", "set", "scheduled". You are REQUESTING
on the customer's behalf. Use conditional phrases:
  - "I will request 3pm for you"
  - "Will let the salon know — they will confirm shortly"
  - "Submitting your request now, salon will confirm"
Only AFTER the system has confirmed a booking (you'd know because reply_text
is being overridden by the caller) can you say "your appointment is booked".
If you're unsure whether a slot is open, do NOT promise it — say "let me
check" instead.`;

const TODAY_ISO = (() => {
  // Computed at module load — fine for a single process lifetime.
  // The LLM uses this to resolve "tomorrow", "kal", etc.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
})();

/**
 * Build the per-business system prompt by appending the salon's real data
 * (services, hours, staff count) plus the structured conversation state.
 *
 * The context may be partial (owner hasn't set everything up yet) — the
 * resulting prompt explicitly tells the LLM what's missing so it can
 * gracefully degrade.
 */
function buildSystemPrompt(
  ctx: SalonContext,
  conversationStatePrompt?: string
): string {
  const lines: string[] = [
    BASE_PROMPT,
    '',
    `Today's date is ${TODAY_ISO} (use this to resolve "today", "tomorrow", "kal").`,
    '',
    `## You are answering for: ${ctx.name}`,
  ];
  if (ctx.city) lines.push(`Location: ${ctx.city}`);
  lines.push(`Timezone: ${ctx.timezone}`);
  lines.push('');

  if (ctx.is_configured) {
    lines.push('## Services this salon offers');
    lines.push('Format each line as: name — duration — price');
    for (const s of ctx.services) {
      const price = s.price != null ? `PKR ${s.price}` : 'price on request';
      lines.push(`- ${s.name} — ${s.duration_minutes} min — ${price}`);
    }
    lines.push('');
  } else {
    lines.push('## Services: NOT YET CONFIGURED');
    lines.push('The salon owner has not added their menu yet. If a customer asks');
    lines.push('about services or prices, say: "The salon is still setting up our');
    lines.push('menu. Let me have the owner share our full list with you shortly."');
    lines.push('');
  }

  if (ctx.hours.length > 0) {
    lines.push('## Weekly hours');
    for (const h of ctx.hours) {
      if (!h.is_open) {
        lines.push(`- ${h.day_of_week}: closed`);
      } else {
        lines.push(`- ${h.day_of_week}: ${h.open_time}–${h.close_time}`);
      }
    }
    lines.push('');
  }

  lines.push(`## Staff: ${ctx.staff_count} active`);
  lines.push('');

  // Structured conversation state — the new source of truth.
  // Replaces verbatim message history. Always included even if empty
  // so the LLM is always aware of the state shape.
  if (conversationStatePrompt && conversationStatePrompt.trim()) {
    lines.push(conversationStatePrompt);
    lines.push('');
  } else {
    lines.push('## Conversation state');
    lines.push('(no state yet — first message in this conversation)');
    lines.push('');
  }

  lines.push('## Booking flow (when intent is "book")');
  lines.push('1. Confirm which service they want');
  lines.push('2. Confirm their preferred date and time');
  lines.push('3. If you have hours for that day, confirm the time falls within them');
  lines.push('4. Ask for their full name and phone number to confirm');
  lines.push('5. Set reply_text to indicate you will request the slot');
  lines.push('');

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