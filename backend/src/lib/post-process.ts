/**
 * LLM reply post-processor (Wave 9 Stage 10).
 *
 * Why this exists
 * ---------------
 * The LLM has strong training priors that compete with our prompt-level
 * instructions:
 *
 *   - "customer says 'bura experience' → escalate to a human"
 *   - "customer asks for owner's number → escalate"
 *   - "booking follow-up mention a date+time+service"
 *
 * When the owner has DISABLED all escalation triggers (Agent Rules page),
 * the LLM still pattern-matches to these behaviors and returns:
 *
 *   intent="complaint"
 *   reply="Yeh sun ke dil toot gaya. Main aapki baat owner tak
 *          pohanchata hoon... 15 August 11 baje ki Nail Art..."
 *
 * — even when the prompt explicitly says "default is NO escalation".
 * No amount of prompt-tuning has won against the prior. So the
 * post-processor acts as a HARD GUARD that runs after the LLM and
 * BEFORE the reply gets persisted or sent.
 *
 * Two rules:
 *
 *   Rule A — Escalation override
 *     If `intent === 'complaint'` AND the owner has NO escalation
 *     triggers enabled → replace the reply with a polite direct-help
 *     line and flip intent to `'other'`. The post-processed reply
 *     flows through to messages + conversation_state + escalation
 *     recording so only what was actually sent ever lands in storage.
 *
 *   Rule B — Hallucinated context guard
 *     Scan the reply for date/time/service mentions that aren't
 *     grounded in any of: customerText, upcomingAppointmentContext,
 *     conversationStateContext, enabled-rule prose. Redact those
 *     mentions. Catches the case where the LLM invents a booking
 *     ("15 August 11 baje Nail Art") the customer never had.
 *
 * Design notes
 * ------------
 *   - Deterministic. No LLM call, no randomness — easy to unit-test.
 *   - Conservative. Rule A only fires when ALL triggers are empty, so
 *     owners who enable even ONE trigger keep their escalation behavior.
 *   - Source-of-truth set includes ALL input fields. Customer's own
 *     message counts as ground truth ("15 August ko" mentioned by the
 *     customer can be echoed back).
 *   - Returns redacted-segment list + `overridden` flag for logging.
 *     Message-handler logs `[post-process] redacted=N` so we can see
 *     when the guard fires in production.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostProcessOptions {
  /** The raw reply text the LLM returned. */
  reply: string;
  /** The intent the LLM classified the customer's message as. */
  intent: string;
  /**
   * Escalation triggers the owner has enabled for this salon.
   * Empty array = owner has disabled ALL escalation — guard fires.
   */
  enabledTriggers: string[];
  /** The exact text the customer sent. Any date/time/service mentioned here is grounded. */
  customerText: string;
  /** Formatted upcoming-appointment block fed into the LLM. */
  upcomingAppointmentContext: string;
  /** Formatted conversation-state block fed into the LLM. */
  conversationStateContext: string;
  /** Active service names at this salon. */
  salonServiceNames: string[];
  /**
   * Whether the customer's text was flagged by detectMedicalConcern
   * upstream. When Rule A fires on a medical question, we use the
   * medical-specific fallback instead of the generic one — the bot
   * shouldn't pretend the customer was asking about regular booking.
   *
   * Computed in message-handler.ts via detectMedicalConcern(text).
   * Default false (no medical flag passed in = no medical concern).
   */
  isMedicalConcern?: boolean;
}

export interface PostProcessResult {
  /** The reply text to send to the customer. May be the original or an override. */
  reply: string;
  /** The intent to record / persist. May be flipped from 'complaint' to 'other'. */
  intent: string;
  /** Human-readable list of segments that were redacted / overridden. For logging. */
  redactedSegments: string[];
  /** True if any rule fired. */
  overridden: boolean;
}

// ---------------------------------------------------------------------------
// Fallback replies — formal, professional tone. No melodrama, no "dil toot
// gaya". Per user spec (2026-08-12): "use formal language because what even
// is dil tot gia".
// ---------------------------------------------------------------------------

const ESCALATION_DISABLED_FALLBACK =
  "I understand your concern, and I want to make sure we get this right. " +
  "Could you tell me a bit more about what you're looking for — I'll do my " +
  "best to help directly.";

/**
 * Medical-specific fallback. Used when Rule A fires AND the customer's
 * text was flagged by detectMedicalConcern upstream. We don't pretend the
 * customer was asking about regular booking — they asked about a symptom,
 * and we explicitly decline to diagnose while offering a regular service.
 *
 * Why a separate fallback: the generic "tell me what you're looking for"
 * reads as a non-answer to a customer describing a nail fungus. They'd
 * reasonably think the bot is broken. The medical-specific fallback
 * names the limitation ("I can't diagnose") and points at the actionable
 * next step (regular service or doctor).
 */
const MEDICAL_CONCERN_FALLBACK =
  "I'm not able to diagnose skin or nail conditions — that needs a doctor " +
  "or dermatologist. If you'd like a regular manicure or pedicure, I can " +
  "book that for you; just let me know what you're looking for.";

// ---------------------------------------------------------------------------
// Patterns for hallucination guard.
// ---------------------------------------------------------------------------

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';

const DATE_PATTERNS: RegExp[] = [
  // English: "15 August", "15th August", "August 15", "August 15th"
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'),
  // UR/Roman Urdu date patterns: "15 ko", "15 tareekh"
  /\b\d{1,2}\s+(?:ko|tareekh|tariq|tarikh)\b/gi,
  // Numeric: "15/08/2026", "15-08-2026", "15.08.2026"
  /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/g,
];

const TIME_PATTERNS: RegExp[] = [
  // English: "11 AM", "11:00 PM", "3:30pm"
  /\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)\b/g,
  // HH:MM
  /\b\d{1,2}:\d{2}\b/g,
  // Roman Urdu: "11 baje", "3 bajne"
  /\b\d{1,2}\s+baj(?:e|ey|ay|ne)\b/gi,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function postProcessReply(opts: PostProcessOptions): PostProcessResult {
  let reply = opts.reply ?? '';
  let intent = opts.intent ?? 'other';
  const redactedSegments: string[] = [];
  let overridden = false;

  // Rule A — Escalation override.
  // When the owner has NOT enabled ANY escalation triggers, the LLM must
  // not escalate. If intent came back as 'complaint' anyway, override.
  // Conservative: only fires when ALL triggers are empty, so owners with
  // any trigger enabled keep their behavior.
  //
  // When the customer's text was flagged as a medical concern upstream,
  // use the medical-specific fallback (explicit "I can't diagnose"
  // + offer regular service). Otherwise the generic fallback reads as
  // a non-answer to a customer describing a real symptom.
  if (intent === 'complaint' && opts.enabledTriggers.length === 0) {
    reply = opts.isMedicalConcern
      ? MEDICAL_CONCERN_FALLBACK
      : ESCALATION_DISABLED_FALLBACK;
    intent = 'other';
    redactedSegments.push(
      opts.isMedicalConcern
        ? 'rule_a:medical_concern_override_triggers_empty'
        : 'rule_a:escalation_overridden_triggers_empty',
    );
    overridden = true;
  }

  // Rule B — Hallucinated context guard.
  // Even with Rule A's escalation override, the LLM can hallucinate
  // specific dates/services in non-escalation replies (e.g. booking-flow
  // replies that mention a time the customer never asked about). Strip
  // any date/time/service mention that isn't grounded in source-of-truth.
  //
  // Skip Rule B when Rule A has already fired: the reply is now a
  // hard-coded fallback string (not LLM output), so there's nothing
  // to hallucinate from. Running Rule B on it would strip legitimate
  // service names from the medical-specific fallback ("regular
  // manicure or pedicure" — "manicure" is in the services list but not
  // in the customer's text, so Rule B wrongly redacts it).
  if (!overridden) {
    const b = stripHallucinatedContext(reply, opts);
    if (b.redacted.length > 0) {
      reply = b.reply;
      redactedSegments.push(...b.redacted);
      overridden = true;
    }
  }

  return { reply, intent, redactedSegments, overridden };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function stripHallucinatedContext(
  reply: string,
  opts: PostProcessOptions
): { reply: string; redacted: string[] } {
  const redacted: string[] = [];
  const groundTruth = [
    opts.customerText ?? '',
    opts.upcomingAppointmentContext ?? '',
    opts.conversationStateContext ?? '',
  ].join('\n');

  let result = reply;

  // Strip dates not in ground truth.
  for (const pattern of DATE_PATTERNS) {
    result = redactPattern(result, pattern, groundTruth, redacted, 'date');
  }
  // Strip times not in ground truth.
  for (const pattern of TIME_PATTERNS) {
    result = redactPattern(result, pattern, groundTruth, redacted, 'time');
  }
  // Strip service names not in ground truth.
  for (const serviceName of opts.salonServiceNames) {
    if (!serviceName || serviceName.length < 3) continue;
    const regex = new RegExp(escapeRegex(serviceName), 'gi');
    const matches = result.match(regex);
    if (!matches) continue;
    // Only redact if the service is NOT mentioned in ground truth.
    if (groundTruthMatches(groundTruth, serviceName)) continue;
    result = result.replace(regex, '').trim();
    redacted.push(`service:${serviceName}`);
  }

  result = cleanAfterRedaction(result);

  return { reply: result, redacted };
}

function redactPattern(
  text: string,
  pattern: RegExp,
  groundTruth: string,
  redacted: string[],
  kind: string
): string {
  // Reset regex state for global patterns across iterations.
  pattern.lastIndex = 0;
  return text.replace(pattern, (match) => {
    if (groundTruthMatches(groundTruth, match)) return match;
    redacted.push(`${kind}:${match}`);
    return '';
  });
}

function groundTruthMatches(groundTruth: string, needle: string): boolean {
  if (!needle) return false;
  // Case-insensitive substring search. Source-of-truth strings are usually
  // short so linear scan is fine.
  return groundTruth.toLowerCase().includes(needle.toLowerCase());
}

function cleanAfterRedaction(text: string): string {
  return text
    // Collapse multiple spaces.
    .replace(/\s{2,}/g, ' ')
    // Strip spaces before punctuation.
    .replace(/\s+([,.!?;:])/g, '$1')
    // Collapse "... . ." → ".".
    .replace(/(\.\s*){2,}/g, '. ')
    // Strip trailing whitespace.
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
