import {
  createAppointmentIfValid,
  AppointmentOutcome,
  updateConversationState,
} from './db';
import type { GenerateReplyResult } from './llm';

// ---------------------------------------------------------------------------
// Booking decision layer.
//
// Takes the structured output from the LLM (intent + slots + reply text)
// and decides whether to actually create an appointment. This is the bridge
// between "LLM understood the customer's message" and "a real row in the
// appointments table".
//
// Used by both message-handler.ts (production WhatsApp flow) and demo.ts
// (jury demo widget) — so the demo and real flow behave identically.
// ---------------------------------------------------------------------------

export interface BookingDecisionContext {
  businessId: string;
  customerId: string;
  conversationId: string;
}

export interface BookingDecisionResult {
  /** Text the bot should actually send to the customer. May be the LLM's
   *  reply verbatim (if no booking happened) or rewritten with confirmation
   *  details (if the booking succeeded). */
  finalReply: string;
  /** Outcome of the booking attempt, or null if no booking was attempted
   *  (e.g. intent wasn't 'book' or slots weren't complete). */
  appointment: AppointmentOutcome | null;
}

/**
 * The minimum slot fields needed to attempt a booking. We require all
 * three to attempt — anything less and the LLM's reply (which asks for
 * the missing pieces) is sent as-is.
 *
 * NOTE: We previously gated on LLM confidence (was 70, lowered to 50)
 * but that's the wrong abstraction. The LLM is in strict compliance with
 * our own prompt that says "Use 90+ only when intent + service + date +
 * time are all clear" — so any message with even minor word ambiguity
 * (e.g. "trim haircut only for tomorrow at 3pm") comes back at ~30-60
 * confidence even though the structured slots are clearly present.
 *
 * The real safety nets are the downstream validators:
 *   1. findServiceByName — fuzzy match against the salon's real menu
 *   2. isWithinBusinessHours — open hours for that day-of-week
 *   3. past_time check — rejection if the requested time has passed
 *   4. get_available_slots() PL/pgSQL — race-safe availability check
 *   5. EXCLUSION constraint on appointments — last-line race defense
 *
 * If those pass, we BOOK. If any fails we return a specific rejection
 * message. There's no scenario where "LLM said confidence was 45" should
 * cause us to silently not-book when all slots are present.
 */
function hasAllBookingSlots(r: GenerateReplyResult): boolean {
  return Boolean(
    r.service_interest &&
    r.preferred_date &&
    r.preferred_time &&
    r.customer_name          // REQUIRED — forces bot to ask for the name
  );
}

/**
 * Persist the booking slots to conversation_state so the next message
 * ("yes 3pm works") is interpreted in context.
 */
async function persistBookingSlots(
  conversationId: string,
  r: GenerateReplyResult
): Promise<void> {
  await updateConversationState(conversationId, {
    current_intent: 'book',
    service_interest: r.service_interest ?? undefined,
    preferred_date: r.preferred_date ?? undefined,
    preferred_time: r.preferred_time ?? undefined,
    customer_name: r.customer_name ?? undefined,
    customer_phone: r.customer_phone ?? undefined,
  });
}

/**
 * Format a confirmation message when an appointment is successfully created.
 * Uses the staff name + service name + readable time.
 */
function formatSuccess(
  outcome: Extract<AppointmentOutcome, { ok: true }>
): string {
  const start = new Date(outcome.scheduledStart);
  // Format in Asia/Karachi local time (PKT, UTC+5)
  const timeStr = start.toLocaleTimeString('en-PK', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const dateStr = start.toLocaleDateString('en-PK', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return (
    `✅ Your appointment is confirmed!\n\n` +
    `• Service: ${outcome.serviceName}\n` +
    `• Stylist: ${outcome.staffName}\n` +
    `• When: ${dateStr} at ${timeStr}\n\n` +
    `We'll see you then. Reply CANCEL if you need to reschedule.`
  );
}

/**
 * Format a rejection message when an appointment can't be created.
 * Includes the reason + alternatives if available.
 */
function formatFailure(
  outcome: Extract<AppointmentOutcome, { ok: false }>
): string {
  switch (outcome.reason) {
    case 'service_not_found':
      return outcome.detail;
    case 'no_staff_for_service':
      return `Sorry — ${outcome.detail}. Please try a different service or time.`;
    case 'outside_hours':
      return `Sorry — ${outcome.detail}. Would you like to pick a different day or time?`;
    case 'past_time':
      return `That time has already passed. What about later today or tomorrow?`;
    case 'slot_taken': {
      const alt =
        outcome.suggestions.length > 0
          ? ` Other available times that day: ${outcome.suggestions
              .map((s) => s.slice(0, 5))
              .join(', ')}.`
          : '';
      return `Sorry — ${outcome.detail}.${alt}`;
    }
    case 'invalid_date_format':
    case 'invalid_time_format':
      return `Sorry — ${outcome.detail}. Could you rephrase the date or time?`;
    default:
      return `Sorry — ${outcome.detail}`;
  }
}

/**
 * Decide whether to attempt a booking and, if so, call
 * createAppointmentIfValid. Returns the final reply text and the booking
 * outcome (for logging / status endpoints).
 *
 * Decision tree:
 *   1. If intent !== 'book': return LLM reply verbatim, no booking attempt
 *   2. If any slot is missing: return LLM reply verbatim (it will be
 *      asking the customer for the missing info)
 *   3. Persist the extracted slots to conversation_state
 *   4. Call createAppointmentIfValid
 *   5. Format success or failure message and return it instead of the LLM's
 *      conditional "I will request" reply
 */
export async function processBookingDecision(
  llmResult: GenerateReplyResult,
  ctx: BookingDecisionContext
): Promise<BookingDecisionResult> {
  // DEBUG: dump full LLM structured output so we can see exactly what
  // came back when testing. Helps diagnose "why didn't it book?" without
  // having to add temporary console.logs in llm.ts. Safe to remove once
  // booking flow is reliable.
  console.log('[booking-decision] intent=%s service=%j date=%j time=%j confidence=%d',
    llmResult.intent,
    llmResult.service_interest,
    llmResult.preferred_date,
    llmResult.preferred_time,
    llmResult.confidence
  );

  // Step 1: only proceed for booking intent
  if (llmResult.intent !== 'book') {
    return { finalReply: llmResult.reply, appointment: null };
  }

  // Step 2: require all slots. Confidence is intentionally NOT gated —
  // downstream validators (fuzzy service match, business hours, etc.)
  // are the real safety floor.
  if (!hasAllBookingSlots(llmResult)) {
    console.log('[booking-decision] SKIPPED — missing slot(s): service=%s date=%s time=%s',
      llmResult.service_interest ?? '(null)',
      llmResult.preferred_date ?? '(null)',
      llmResult.preferred_time ?? '(null)'
    );
    return { finalReply: llmResult.reply, appointment: null };
  }

  // Step 3: state persistence is now handled in message-handler.ts
  // (right after the LLM call, before this function runs). That way
  // every LLM call — not just `book` attempts — keeps the
  // conversation_state in sync with the LLM's latest understanding.
  // Doing it here too would race with that update and be redundant.

  // Step 4: attempt the booking
  let outcome: AppointmentOutcome;
  try {
    console.log('[booking-decision] ATTEMPTING booking for service=%s date=%s time=%s',
      llmResult.service_interest,
      llmResult.preferred_date,
      llmResult.preferred_time
    );
    outcome = await createAppointmentIfValid({
      businessId: ctx.businessId,
      customerId: ctx.customerId,
      serviceName: llmResult.service_interest!,
      preferredDate: llmResult.preferred_date!,
      preferredTime: llmResult.preferred_time!,
    });
    console.log('[booking-decision] createAppointmentIfValid returned: ok=%s reason=%s',
      outcome.ok,
      outcome.ok ? 'confirmed' : outcome.reason
    );
  } catch (e) {
    // DATABASE ERROR — log it loudly so we can actually see what failed.
    // Previously we silently swallowed this and fell back to the LLM's
    // safe reply ("salon will confirm shortly"), which made bookings look
    // like they weren't being attempted when they were actually throwing.
    console.error('[booking-decision] createAppointmentIfValid THREW:',
      (e as Error).message,
      '\nSTACK:', (e as Error).stack
    );
    return {
      finalReply: llmResult.reply,
      appointment: null,
    };
  }

  // Step 5: format the final reply based on outcome
  const finalReply = outcome.ok
    ? formatSuccess(outcome)
    : formatFailure(outcome);

  return { finalReply, appointment: outcome };
}