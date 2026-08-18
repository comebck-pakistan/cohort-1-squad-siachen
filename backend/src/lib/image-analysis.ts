import axios from 'axios';
import { childLogger } from './logger';
import type { SalonService } from './db';

// ---------------------------------------------------------------------------
// Image analysis — Wave 18.
//
// Why this exists:
//   Recepta is a WhatsApp AI receptionist. Today the bot only handles text
//   messages — when a customer sends an image (a reference photo of a
//   hairstyle, a picture of a skin reaction, a meme, a screenshot, ANY
//   image), the message is silently dropped at the transport layer
//   (see backend/src/lib/whatsapp.ts:62 and bridge/src/client.ts:466).
//
//   That's a bad customer experience. Customers send photos expecting
//   the salon to react.
//
// Approach — LLM as classifier (NOT a separate vision model):
//   Use the existing MiniMax M3 integration as the PRIMARY multimodal
//   model. MiniMax M3 is natively multimodal — we send the image bytes
//   as a base64 content block in the same chat-completion call structure
//   the text path already uses. The model returns open-ended JSON with
//   free-text fields, NOT a hardcoded category enum.
//
//   If MiniMax M3 fails / times out / errors, fall back to Google
//   Gemini 2.5 Flash-Lite (free tier, also natively multimodal). Both
//   models accept the same {system, user[{type:'text',...},
//   {type:'image_url',...}]} shape.
//
//   If both providers fail, return a structured FALLBACK_RESULT so the
//   caller can still produce a generic acknowledgment ("Got your photo
//   — someone from the team will follow up shortly").
//
// What we DO NOT do:
//   - No separate vision microservice.
//   - No third-party image-classification API (Clarifai, Google Vision, etc).
//   - No fixed category enum that would need to be updated every time the
//     salon adds a service. The relevance field is intentionally narrow
//     (3 buckets) but the actual reply content comes from free-text
//     image_description, so the bot sounds specific to what was sent.
//   - No OCR pipeline or document extraction. If the image is a receipt,
//     we treat it as unrelated_or_unclear and let the customer describe
//     it in their own words.
//
// Safety net:
//   When image_description or intent_notes contains a health/injury/
//   reaction/pain-adjacent term — even if the model picked a different
//   bucket — we force escalate_to_human=true. This catches the edge
//   cases where the model's classification logic missed a health signal.
//   See applySafetyNet() for the keyword list and reasoning.
//
// Storage:
//   Every classification row lands in `image_analysis_logs` (see
//   database/schema/21_image_analysis_logs.sql) so we have a real
//   audit trail of what customers actually send over time.
// ---------------------------------------------------------------------------

const log = childLogger('image-analysis');

// ===== Provider config =======================================================

// Primary: MiniMax M3. Same env var convention as the text LLM (the .env
// key is named ANTHROPIC_API_KEY for historical reasons — see llm.ts:5).
const MINIMAX_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MINIMAX_MODEL = 'MiniMax-M3';
const MINIMAX_API_URL = 'https://api.minimax.io/v1/chat/completions';

// Fallback: Google Gemini 2.5 Flash-Lite. Free tier, natively multimodal,
// same JSON-output pattern. New env var — GEMINI_API_KEY.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
// Gemini's REST API URL pattern. Uses query-string key auth.
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Total budget per image — primary attempt + fallback must fit inside this
// so we don't lock a customer conversation waiting on a stuck provider.
// The text LLM call already takes 20-70s in the worst case; image calls
// tend to be slower because the model has to ingest the bytes. 45s primary
// + 30s fallback = 75s worst-case, well within the bridge's 90s per-attempt
// timeout.
const MINIMAX_TIMEOUT_MS = 45_000;
const GEMINI_TIMEOUT_MS = 30_000;

// ===== Classification shape ==================================================

/**
 * The three open-ended buckets the model picks from.
 *
 * Kept deliberately broad so we never need to add new categories as the
 * salon's service list changes or customers send novel content. The
 * ACTUAL reply text comes from free-text `draft_reply`, so the bot
 * sounds specific to what was sent without us pattern-matching a
 * service-specific reply template per case.
 */
export type ImageClassification =
  | 'service_reference'        // photo tied to a service the salon offers
  | 'concern_or_complaint'     // something went wrong / didn't expect
  | 'unrelated_or_unclear';    // memes, receipts, screenshots, personal photos

export type ImageConfidence = 'high' | 'medium' | 'low';

export interface ImageAnalysis {
  /** What the model actually saw in the image (free text). */
  image_description: string;
  /** Which of the three buckets the model picked. */
  classification: ImageClassification;
  /** The model's own reasoning for the bucket it picked. */
  intent_notes: string;
  /** Model's self-reported confidence. */
  confidence: ImageConfidence;
  /** True when the model thinks a human should follow up. */
  escalate_to_human: boolean;
  /** True when the safety-net override flipped escalate_to_human=true. */
  safety_net_triggered: boolean;
  /** The reply text the bot should send to the customer. */
  draft_reply: string;
  /** Which provider produced this result. */
  llm_provider: 'minimax' | 'gemini';
  /** Model identifier for audit. */
  llm_model: string;
  /** Wall-clock latency for this single call. */
  latency_ms: number;
}

/**
 * Last-resort result used when both providers fail. The caller is
 * expected to send `draft_reply` verbatim to the customer.
 */
export const FALLBACK_IMAGE_RESULT: ImageAnalysis = {
  image_description: '(image analysis failed — both providers errored)',
  classification: 'unrelated_or_unclear',
  intent_notes: 'fallback — provider error',
  confidence: 'low',
  escalate_to_human: false,
  safety_net_triggered: false,
  draft_reply:
    'Got your photo — someone from the team will follow up shortly.',
  llm_provider: 'minimax',
  llm_model: 'fallback',
  latency_ms: 0,
};

// ===== Health-safety-net keywords ============================================

/**
 * Words that, when present in the model's free-text reasoning, override
 * the classification decision to escalate. We check BOTH
 * image_description and intent_notes (the model's own description of
 * what it saw AND why it picked the bucket) because either may surface
 * the signal first.
 *
 * Pattern is intentionally a list of stems rather than a regex — keeps
 * matches obvious to a code reader and easy to extend. Word boundaries
 * matter: 'rash' should match 'skin rash' but NOT 'rashes' (a hairstyle
 * shape, e.g. "rashes of curls") — we use a basic \bword\b match below
 * with case-insensitive flag.
 */
const HEALTH_SAFETY_NET_TERMS = [
  'rash',
  'reaction',
  'reactions',
  'allergic',
  'allergy',
  'infection',
  'infected',
  'swelling',
  'swollen',
  'burn',
  'burned',
  'burnt',
  'bleeding',
  'blood',
  'pain',
  'painful',
  'hurt',
  'hurts',
  'injury',
  'injured',
  'wound',
  'cut',         // matches "skin cut" — generic "cut my hair" is a booking intent, but the model's intent_notes should make that clear
  'damage',      // "hair damage" / "nail damage" still means the customer is unhappy
  'broken',
  'scald',
  'sore',
  'redness',
  'red and',
  'bumpy',
  'pustule',
  'pimple',
  'blister',
  'hive',
  'hives',
  'peeling',
  'peeled',
  'irritation',
  'irritated',
  'sensitive',
  'sensitivity',
];

/**
 * Returns true when the model's free-text reasoning mentions any
 * health-adjacent term. Used to FORCE escalate_to_human=true even if
 * the model picked `service_reference` or `unrelated_or_unclear`.
 */
function applySafetyNet(
  imageDescription: string,
  intentNotes: string
): boolean {
  const haystack = `${imageDescription}\n${intentNotes}`.toLowerCase();
  for (const term of HEALTH_SAFETY_NET_TERMS) {
    // \b doesn't work cleanly for "cut" (would still match "cut my hair"
    // which IS a concern). We instead just substring-match the term —
    // the model's intent_notes normally disambiguates ("Customer wants
    // this haircut style" → not a concern; "Cut on the scalp from
    // yesterday's service" → concern). For the rare case where the
    // model's notes are bad, the safety net escalates — false-positive
    // escalation is cheap (a human can mark resolved), false-negative
    // is not.
    if (haystack.includes(term)) return true;
  }
  return false;
}

// ===== Prompts ===============================================================

/**
 * System prompt for the image-classification call.
 *
 * Built per-call via `buildImageSystemPrompt(salonName, salonServices)`
 * so the model knows what THIS salon offers. Without this injection,
 * the model treated every beauty image as in-scope — a customer sent a
 * hair photo to a nail-only salon and got "bring this photo, our stylist
 * can match" instead of "sorry, we don't offer hair services here".
 *
 * Same personality as the text bot, but the OUTPUT FORMAT is different —
 * we want structured JSON, not a customer-facing reply. The bot's reply
 * to the customer is `draft_reply` (one of the fields).
 *
 * We do NOT enumerate a category list beyond the three BROAD buckets
 * (service_reference / concern_or_complaint / unrelated_or_unclear). The
 * actual reply text is generated from `image_description` so it sounds
 * specific to what was sent.
 */
function buildImageSystemPrompt(
  salonName?: string,
  salonServices?: Pick<SalonService, 'name' | 'duration_minutes' | 'price'>[]
): string {
  const displayName = (salonName?.trim() || 'this salon').replace(/\s+/g, ' ');

  // Build the "WHAT THIS SALON OFFERS" block. Empty list ⇒ unconfigured
  // (the owner hasn't set services yet); we still surface that fact to
  // the model so it doesn't pretend the salon offers everything.
  let servicesBlock: string;
  if (salonServices && salonServices.length > 0) {
    const lines = salonServices.map((s) => {
      const meta: string[] = [];
      if (typeof s.duration_minutes === 'number' && s.duration_minutes > 0) {
        meta.push(`${s.duration_minutes} min`);
      }
      if (typeof s.price === 'number' && s.price > 0) {
        meta.push(`PKR ${s.price}`);
      }
      return meta.length > 0
        ? `- ${s.name} (${meta.join(', ')})`
        : `- ${s.name}`;
    });
    servicesBlock = `${displayName} offers ONLY these services:\n${lines.join('\n')}`;
  } else {
    servicesBlock = `${displayName}'s service list is empty (the owner hasn't configured services yet). Treat every photo that looks like a beauty service as unrelated_or_unclear and politely ask the customer to describe what they want so the owner can follow up.`;
  }

  return `You are an image-classification assistant for ${displayName}'s WhatsApp AI receptionist.

A customer just sent a photo over WhatsApp. Your job is to look at the image, classify what it is, and produce both metadata (for the salon's internal logs) AND a short reply the bot should send back to the customer.

## TOP-LEVEL BINDING CONSTRAINTS (read first, override everything below)

1. NEVER diagnose. If the image looks like a medical concern (rash, burn, allergic reaction, swelling, infection, bleeding, injury, etc.), say so in image_description but do NOT speculate on what caused it, what condition it is, how severe, or what to do about it. The salon team — not you — handles the clinical side.

2. NEVER escalate automatically. Only set escalate_to_human=true when the image is genuinely a complaint or concern that needs human follow-up. A reference photo is NOT an escalation — it's a normal booking-context image.

3. NEVER invent service names, prices, or availability. If the image is a reference photo for a service the salon offers, the bot's draft_reply just tells the customer to bring the photo to their appointment — it does NOT confirm any booking details.

4. STAY IN SCOPE — this is critical. Compare the photo against ${displayName}'s actual services list below. If the photo shows a service the salon does NOT offer (for example, a customer sends a hair photo to a nail-only salon), classify it as unrelated_or_unclear and the draft_reply should politely say something like: "Thanks for sharing! That looks like [what it is] — sorry, we don't offer [that] at ${displayName}. We do offer [list the salon's actual services briefly]. Want to book one of those instead?" Do NOT invite the customer to bring a reference photo the salon can't fulfill.

5. NEVER force-fit a service reference. If the image is a meme, a screenshot, a receipt, an unrelated personal photo, or genuinely ambiguous, classify it as unrelated_or_unclear and reply naturally (brief acknowledgment or a clarifying question).

6. Reply in the customer's language style. Roman Urdu image → Roman Urdu draft_reply. English image → English draft_reply. Don't switch mid-response.

## WHAT THIS SALON OFFERS

${servicesBlock}

Anything the customer shows you that doesn't appear in this list is OUT OF SCOPE for this salon.

## CLASSIFICATION BUCKETS

Pick EXACTLY ONE — these are deliberately broad so we never need to add new categories:

- **service_reference**: The photo is a visual reference tied to a service in the list above (${displayName} offers it). The customer is showing the salon what they want. Draft_reply: tell them to bring the photo to their appointment.
- **concern_or_complaint**: The photo shows something that didn't go the way the customer expected — bad result from a previous service, skin reaction, uneven work, damage, anything that reads as "this isn't right." Set escalate_to_human=true.
- **unrelated_or_unclear**:
  - Out-of-scope service ${displayName} does NOT offer (use the redirect-to-actual-services draft shape from rule 4).
  - Memes, screenshots, receipts, unrelated personal photos (brief acknowledgment).
  - Genuinely ambiguous (clarifying question).

## OUTPUT FORMAT — JSON only, no preamble, no markdown fences:

{
  "image_description": string — what you actually see in the image (1-3 sentences, plain language),
  "classification": one of "service_reference" | "concern_or_complaint" | "unrelated_or_unclear",
  "intent_notes": string — your reasoning for why you picked that bucket (1-2 sentences, plain language),
  "confidence": one of "high" | "medium" | "low",
  "escalate_to_human": boolean — true ONLY when classification="concern_or_complaint" (or a strong reason to have a human follow up),
  "draft_reply": string — the actual reply the bot will send back to the customer. MUST be phrased specifically to what's in image_description AND consistent with the salon's actual services, NOT a generic template. 1-3 sentences. Warm, professional, no melodrama, no emoji except a single check mark or hand-wave when fitting.
}`;
}

// ===== Public API ============================================================

export interface AnalyzeImageOptions {
  /** Base64-encoded image bytes (no data: prefix). */
  imageBase64: string;
  /** MIME type, e.g. 'image/jpeg', 'image/png', 'image/webp'. */
  mimeType: string;
  /** Optional caption text the customer included with the image. */
  caption?: string;
  /**
   * Wave 18 — salon context for the prompt. Without this, the model
   * produced "bring this photo, our stylist can match" for any beauty
   * image regardless of whether the salon offers that service (a customer
   * sent a hair photo to a nail-only salon got the same reply they'd get
   * at a hair salon). Passing the service list fixes that: the model now
   * picks unrelated_or_unclear for out-of-scope photos and drafts a
   * redirect reply listing the salon's actual services.
   *
   * `salonName` is used to personalize the salutation + the redirect
   * reply. `salonServices` shape mirrors `SalonService` from db.ts so
   * callers can pass `salonContext.services` directly without mapping.
   */
  salonName?: string;
  salonServices?: Pick<SalonService, 'name' | 'duration_minutes' | 'price'>[];
}

/**
 * Analyze a customer-sent image end-to-end.
 *
 *   1. Try MiniMax M3 (primary).
 *   2. On failure / parse error, try Gemini 2.5 Flash-Lite (fallback).
 *   3. On both failing, return FALLBACK_IMAGE_RESULT.
 *
 * After a successful parse, apply the health-safety-net override:
 *   if image_description OR intent_notes mentions any health/injury/
 *   reaction term, force escalate_to_human=true. Mark the row with
 * safety_net_triggered=true so we can audit how often the override fires.
 *
 * The caller (message-handler.ts) decides what to DO with the result
 * based on `classification` and `escalate_to_human`:
 *   - service_reference       → return draft_reply to the customer.
 *   - concern_or_complaint   → return draft_reply AND record an
 *                               escalation_events row.
 *   - unrelated_or_unclear   → if a caption was provided, forward the
 *                               caption to the normal text LLM call.
 *                               Otherwise return draft_reply and treat
 *                               as a normal bot turn.
 *
 * Never throws — returns FALLBACK_IMAGE_RESULT on any unexpected error
 * so the customer conversation never crashes.
 */
export async function analyzeImage(
  opts: AnalyzeImageOptions
): Promise<ImageAnalysis> {
  const t0 = Date.now();

  // Primary: MiniMax M3
  if (MINIMAX_API_KEY) {
    try {
      const result = await callMinimax(opts);
      const safety = applySafetyNet(result.image_description, result.intent_notes);
      const escalated = result.escalate_to_human || safety;
      log.info(
        {
          classification: result.classification,
          confidence: result.confidence,
          escalate_to_human: result.escalate_to_human,
          safety_net_triggered: safety,
          latency_ms: result.latency_ms,
          provider: 'minimax',
        },
        'image_analyzed_minimax'
      );
      return {
        ...result,
        safety_net_triggered: safety,
        escalate_to_human: escalated,
      };
    } catch (e) {
      log.warn(
        { err: (e as Error).message },
        'image_analyze_minimax_failed_falling_back_to_gemini'
      );
      // Fall through to Gemini.
    }
  } else {
    log.warn('image_analyze_minimax_key_missing_skipping_primary');
  }

  // Fallback: Gemini 2.5 Flash-Lite
  if (GEMINI_API_KEY) {
    try {
      const result = await callGemini(opts);
      const safety = applySafetyNet(result.image_description, result.intent_notes);
      const escalated = result.escalate_to_human || safety;
      log.info(
        {
          classification: result.classification,
          confidence: result.confidence,
          escalate_to_human: result.escalate_to_human,
          safety_net_triggered: safety,
          latency_ms: result.latency_ms,
          provider: 'gemini',
        },
        'image_analyzed_gemini'
      );
      return {
        ...result,
        safety_net_triggered: safety,
        escalate_to_human: escalated,
      };
    } catch (e) {
      log.warn(
        { err: (e as Error).message },
        'image_analyze_gemini_failed_using_hard_fallback'
      );
      // Fall through to hard fallback.
    }
  } else {
    log.warn('image_analyze_gemini_key_missing_skipping_fallback');
  }

  // Hard fallback — both providers unavailable.
  log.error(
    { latency_ms: Date.now() - t0 },
    'image_analyze_all_providers_failed'
  );
  return {
    ...FALLBACK_IMAGE_RESULT,
    latency_ms: Date.now() - t0,
  };
}

// ===== Provider implementations ==============================================

async function callMinimax(
  opts: AnalyzeImageOptions
): Promise<ImageAnalysis> {
  const t0 = Date.now();
  const response = await axios.post(
    MINIMAX_API_URL,
    {
      model: MINIMAX_MODEL,
      // Image analysis returns a small structured object — no need for
      // the 6000-token budget the text path uses. 1500 is enough for
      // the JSON + a 1-3 sentence draft_reply.
      max_tokens: 1500,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: buildImageSystemPrompt(opts.salonName, opts.salonServices),
        },
        {
          role: 'user',
          content: [
            // OpenAI-compatible multimodal shape: an array of typed
            // content blocks. text + image_url. The bridge sends
            // base64 with a data: URI prefix; we strip it to a plain
            // data URL here so we can support either format from the
            // caller.
            {
              type: 'text',
              text: buildUserPrompt(opts.caption),
            },
            {
              type: 'image_url',
              image_url: {
                url: toDataUrl(opts.imageBase64, opts.mimeType),
              },
            },
          ],
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: MINIMAX_TIMEOUT_MS,
    }
  );

  const rawContent: string =
    response.data?.choices?.[0]?.message?.content || '';
  const finishReason: string | undefined =
    response.data?.choices?.[0]?.finish_reason;

  const parsed = parseImageAnalysisJson(rawContent);
  if (!parsed) {
    throw new Error(
      `minimax returned unparseable JSON (finish_reason=${finishReason ?? 'unknown'})`
    );
  }

  return {
    ...parsed,
    llm_provider: 'minimax',
    llm_model: MINIMAX_MODEL,
    latency_ms: Date.now() - t0,
  };
}

async function callGemini(
  opts: AnalyzeImageOptions
): Promise<ImageAnalysis> {
  const t0 = Date.now();
  // Gemini's REST API uses a different shape than OpenAI-compatible
  // endpoints. We build the request manually here.
  const response = await axios.post(
    `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
    {
      // Gemini also supports system_instruction; pass the prompt there
      // so the user message stays focused on the image + caption.
      system_instruction: {
        parts: [
          { text: buildImageSystemPrompt(opts.salonName, opts.salonServices) },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildUserPrompt(opts.caption) },
            {
              inline_data: {
                mime_type: opts.mimeType,
                data: stripDataUrlPrefix(opts.imageBase64),
              },
            },
          ],
        },
      ],
      // Force JSON output. Gemini supports this via generationConfig.
      generationConfig: {
        response_mime_type: 'application/json',
        max_output_tokens: 1500,
      },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: GEMINI_TIMEOUT_MS,
    }
  );

  // Gemini returns candidates[0].content.parts[0].text.
  const rawContent: string =
    response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const finishReason: string | undefined =
    response.data?.candidates?.[0]?.finishReason;

  const parsed = parseImageAnalysisJson(rawContent);
  if (!parsed) {
    throw new Error(
      `gemini returned unparseable JSON (finish_reason=${finishReason ?? 'unknown'})`
    );
  }

  return {
    ...parsed,
    llm_provider: 'gemini',
    llm_model: GEMINI_MODEL,
    latency_ms: Date.now() - t0,
  };
}

// ===== Helpers ===============================================================

function buildUserPrompt(caption?: string): string {
  // Wrap any customer caption in a short frame so the model knows the
  // caption is OPTIONAL context, not the primary input. The image is
  // the primary input — that's the whole point of this branch.
  if (!caption || caption.trim().length === 0) {
    return 'The customer sent the image above with no caption. Classify it and reply.';
  }
  return `The customer sent the image above with this caption: "${caption.trim()}"

Use both the image AND the caption to classify. The caption is OPTIONAL context — the image is primary.`;
}

function toDataUrl(base64: string, mimeType: string): string {
  // If the caller already prefixed a data URL, leave it alone.
  if (base64.startsWith('data:')) return base64;
  return `data:${mimeType};base64,${base64}`;
}

function stripDataUrlPrefix(base64: string): string {
  // Gemini's inline_data.data wants raw base64 (no data: prefix).
  if (base64.startsWith('data:')) {
    const commaIdx = base64.indexOf(',');
    return commaIdx === -1 ? base64 : base64.substring(commaIdx + 1);
  }
  return base64;
}

const VALID_CLASSIFICATIONS: ReadonlySet<ImageClassification> = new Set([
  'service_reference',
  'concern_or_complaint',
  'unrelated_or_unclear',
]);

const VALID_CONFIDENCE: ReadonlySet<ImageConfidence> = new Set([
  'high',
  'medium',
  'low',
]);

/**
 * Parse the model's raw output into our structured shape.
 *
 * Both providers are configured to return JSON only (Gemini via
 * response_mime_type=application/json, MiniMax via the system prompt
 * saying "JSON only, no preamble, no markdown fences"). We still do a
 * defensive parse because real-world model output sometimes wraps JSON
 * in fences or adds preamble text — same pattern as llm.ts:642-682.
 *
 * Returns null on any failure so the caller can retry against the
 * fallback provider.
 */
function parseImageAnalysisJson(raw: string): ImageAnalysis | null {
  if (!raw || raw.trim().length === 0) return null;

  // Try the whole string first.
  const direct = tryParseJson(raw);
  if (direct) return normalizeImageAnalysis(direct);

  // Strip markdown code fences if present.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inner = tryParseJson(fenced[1]);
    if (inner) return normalizeImageAnalysis(inner);
  }

  // Last resort: find the first {...} block in the string.
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const inner = tryParseJson(raw.substring(firstBrace, lastBrace + 1));
    if (inner) return normalizeImageAnalysis(inner);
  }

  log.warn(
    { rawLength: raw.length, rawPreview: raw.slice(0, 200) },
    'image_analysis_json_parse_failed'
  );
  return null;
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

function normalizeImageAnalysis(
  obj: Record<string, unknown>
): ImageAnalysis {
  const classification = clampClassification(obj.classification);
  const confidence = clampConfidence(obj.confidence);

  return {
    image_description: typeof obj.image_description === 'string'
      ? obj.image_description.trim() || '(no description)'
      : '(no description)',
    classification,
    intent_notes: typeof obj.intent_notes === 'string'
      ? obj.intent_notes.trim() || '(no intent notes)'
      : '(no intent notes)',
    confidence,
    escalate_to_human: typeof obj.escalate_to_human === 'boolean'
      ? obj.escalate_to_human
      : // Default: concern bucket always escalates; other buckets
        // require an explicit true. Matches the system prompt's
        // "set escalate_to_human=true ONLY when classification is
        // concern_or_complaint" rule.
        classification === 'concern_or_complaint',
    draft_reply: sanitizeDraftReply(obj.draft_reply, classification),
    // Provider-tracking fields are filled by the caller (callMinimax /
    // callGemini) after this helper returns. Defaults here keep the
    // shape complete so a parsed object always satisfies ImageAnalysis.
    safety_net_triggered: false,
    llm_provider: 'minimax',
    llm_model: '',
    latency_ms: 0,
  };
}

function clampClassification(raw: unknown): ImageClassification {
  if (typeof raw === 'string' && VALID_CLASSIFICATIONS.has(raw as ImageClassification)) {
    return raw as ImageClassification;
  }
  // Defensive: model returned an unknown bucket. Default to the safest
  // option (unrelated_or_unclear) which doesn't trigger an escalation
  // and doesn't claim the photo is service-related.
  return 'unrelated_or_unclear';
}

function clampConfidence(raw: unknown): ImageConfidence {
  if (typeof raw === 'string' && VALID_CONFIDENCE.has(raw as ImageConfidence)) {
    return raw as ImageConfidence;
  }
  return 'low';
}

function sanitizeDraftReply(
  raw: unknown,
  classification: ImageClassification
): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    // Fall back to a bucket-appropriate default so the bot never sends
    // an empty / malformed reply.
    if (classification === 'service_reference') {
      return 'Got your reference photo — please bring it when you come in for your appointment.';
    }
    if (classification === 'concern_or_complaint') {
      return "I understand your concern. I'm connecting you with the team — they'll follow up shortly.";
    }
    return "Got your photo — what would you like to know?";
  }
  // Strip any <think> blocks that survived parsing (some models emit
  // them inline regardless of the JSON-only instruction).
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}