import {
  createAppointmentIfValid,
  AppointmentOutcome,
  updateConversationState,
  getConversationState,
  rescheduleAppointment,
  cancelUpcomingAppointment,
} from './db';
import type { GenerateReplyResult } from './llm';

// ---------------------------------------------------------------------------
// Confirmation-prompt guard (Wave 9 Stage 15).
//
// The TOP-LEVEL BINDING CONSTRAINT in llm.ts says "ALWAYS RECONFIRM before
// destructive actions". But the prompt rule alone isn't reliable — the LLM
// sometimes returns intent=reschedule with all slots filled AND a reply
// that's a confirmation prompt like "Confirming: Nail Art Full Set on
// Thu 13 Aug 4 PM with Sana Malik. Shall I proceed?". Without this guard,
// handleReschedule / handleBook / handleCancel would immediately execute
// the destructive action and overwrite the LLM's confirmation prompt
// with "✅ Rescheduled!" — defeating the whole point of asking first.
//
// Heuristic: if the LLM's reply contains confirmation-seeking language
// ("shall I proceed", "confirming:", "sahi?", "theek?", "haan kar dun?", etc.),
// skip the destructive action and return the LLM's reply verbatim. The
// customer reads the prompt, replies "haan kar do", and the NEXT turn the
// LLM returns intent=reschedule with the same slots but WITHOUT the
// confirmation phrasing — at which point the destructive handler runs.
//
// This is a heuristic — a future improvement would be to add an explicit
// `awaiting_confirmation: boolean` field to GenerateReplyResult and have
// the prompt instruct the LLM to set it. For now the patterns below catch
// every phrasing we've seen the LLM produce.
// ---------------------------------------------------------------------------

const CONFIRMATION_PROMPT_PATTERNS: RegExp[] = [
  // English phrasing
  /\bshall\s+i\s+(proceed|go ahead|book|submit|request|reschedule|cancel|do this|confirm)\b/i,
  /\bconfirming\s*[:\-]/i,
  /\bconfirming\s+(your|that|this|the)\b/i,
  /\bis\s+(this|that|it)\s+(correct|right|okay|ok)\s*\??/i,
  /\bjust\s+to\s+confirm\b/i,
  /\bcan\s+i\s+confirm\b/i,
  /\bplease\s+confirm\b/i,
  /\breply\s+(with\s+)?(yes|haan|kar\s+do|confirm)\b/i,
  /\bshall\s+i\s+go\s+ahead\b/i,

  // Roman Urdu phrasing
  /\bsahi?\s+(hai|he|hain)\s*\??/i,
  /\bsahi\s*\??/i,             // bare "Sahi?" at end of sentence
  /\btheek?\s+(hai|he|hain)\s*\??/i,
  /\btheek\s*\??/i,            // bare "Theek?"
  /\bconfirm\s+kar(\s+dun|\s+do|\s+den)?\??/i,
  /\bkar\s+(dun|do|den)\s*\??/i,
  /\bsubmit\s+kar(\s+dun|\s+do|\s+den)?\??/i,
  /\bhaan?\s+(kar\s+do|kar\s+dun|sahi\s+hai)\s*\??/i,
  /\bsahi?\s+lag\s+(raha|rha)\s+(hai|he)?\s*\??/i,
];

/**
 * Returns true if the LLM's reply text looks like a confirmation-seeking
 * prompt rather than a confirmation / success. Heuristic-based — see the
 * CONFIRMATION_PROMPT_PATTERNS comment above for context.
 *
 * IMPORTANT: this must NOT trigger on success messages ("Booked!",
 * "Rescheduled!") or on simple clarifying questions that aren't asking
 * for destructive-action confirmation ("which service did you mean?").
 * The patterns above are scoped to confirmation-of-action phrasing only.
 */
export function isConfirmationPrompt(reply: string): boolean {
  if (!reply) return false;
  // Strip any think blocks that survived parsing.
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return CONFIRMATION_PROMPT_PATTERNS.some((p) => p.test(cleaned));
}

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
    r.service_interest && r.preferred_date && r.preferred_time
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
      // The DB layer only returns this when start_time < now AND the date
      // matches today (parseLocalDateTime produces a future datetime when
      // the date is in the future, so a past_time on a future date is
      // already impossible). So this branch is by definition today-only.
      // Suggest alternatives rather than the old "later today or tomorrow"
      // which the LLM was echoing verbatim 3 times in a row.
      return `That time has already passed for today. Pick a later time today, or I can show you tomorrow's available slots — just say the word.`;
    case 'slot_taken': {
      const alt =
        outcome.suggestions.length > 0
          ? ` Other available times that day: ${outcome.suggestions
              .map((s) => s.slice(0, 5))
              .join(', ')}.`
          : '';
      return `Sorry — ${outcome.detail}.${alt}`;
    }
    case 'customer_already_booked': {
      // Format the existing booking's start time in PKT for the message,
      // since the user lives in Pakistan.
      const conflict = outcome.conflict;
      if (!conflict) {
        // Should never happen, but defensively degrade.
        return outcome.detail;
      }
      const when = new Date(conflict.startTime);
      const whenStr = when.toLocaleString('en-PK', {
        timeZone: 'Asia/Karachi',
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      });
      const existingSvc = conflict.serviceName;
      // Roman Urdu phrasing: name the existing service + time, then offer
      // two choices — cancel-and-rebook OR pick a different time.
      // Mirrors the user's preferred template:
      //   "ye kab book kron ya apki is time slot per pehlay wali cancel ker dun?"
      // Plus a clarifying question for the customer to choose.
      return (
        `Aap ke paas pehlay se **${existingSvc}** ki booking hai ` +
        `**${whenStr}** pe. ` +
        `Kya aap chahti hain ke usko cancel ker ke ye nayi booking ker dun, ` +
        `ya kisi aur time slot me book ker dun?`
      );
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
    // Reschedule / cancel are handled below as soon as we have slots (or
    // for cancel, even without — "cancel" doesn't need a new time).
    if (llmResult.intent === 'cancel') {
      return await handleCancel(llmResult, ctx);
    }
    if (llmResult.intent === 'reschedule') {
      return await handleReschedule(llmResult, ctx);
    }
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

  // Step 3: persist slots so follow-up messages ("yes 3pm") interpret correctly
  try {
    await persistBookingSlots(ctx.conversationId, llmResult);
    console.log('[booking-decision] slot state persisted');
  } catch (e) {
    console.warn('[booking-decision] persistBookingSlots failed (non-fatal):',
      (e as Error).message);
    // Non-fatal — continue with booking attempt anyway.
  }

  // Step 3.5: SERVICE-LOCK GUARD — if conversation_state already has a
  // selected_service from a previous turn AND the LLM just gave us a
  // partial phrase that doesn't EXACTLY equal it, prefer the locked
  // value. This prevents the recurring bug where the customer says
  // "full set" (partial) and findServiceByName() fuzzy-matches
  // "Acrylic Full Set" instead of the locked "Nail Art Full Set".
  let effectiveServiceName = llmResult.service_interest!;
  try {
    const locked = await getConversationState(ctx.conversationId);
    if (locked?.service_interest) {
      const candidate = llmResult.service_interest!.trim();
      const lockedName = locked.service_interest.trim();
      if (
        candidate.toLowerCase() !== lockedName.toLowerCase() &&
        lockedName.toLowerCase().includes(candidate.toLowerCase())
      ) {
        // LLM gave us a substring of the locked value ("full set" inside
        // "Nail Art Full Set"). Use the locked full name.
        console.log(
          '[booking-decision] SERVICE-LOCK: replacing llmService="%s" with locked="%s"',
          candidate,
          lockedName
        );
        effectiveServiceName = lockedName;
      }
    }
  } catch (e) {
    console.warn('[booking-decision] service-lock check failed (non-fatal):',
      (e as Error).message);
  }

  // Step 3.9: Stage 16 — confirmation gate. If the LLM is asking the
  // customer to confirm ("shall I proceed", "Confirming: ...", "sahi?"),
  // skip the destructive action and send the prompt. The customer
  // replies "haan kar do"; the LLM then returns intent=book with the
  // same slots but without confirmation phrasing; we book here.
  if (isConfirmationPrompt(llmResult.reply)) {
    console.log('[booking-decision] book AWAITING CONFIRMATION — skipping destructive action');
    return { finalReply: llmResult.reply, appointment: null };
  }

  // Step 4: attempt the booking
  let outcome: AppointmentOutcome;
  try {
    console.log('[booking-decision] ATTEMPTING booking for service=%s date=%s time=%s',
      effectiveServiceName,
      llmResult.preferred_date,
      llmResult.preferred_time
    );
    outcome = await createAppointmentIfValid({
      businessId: ctx.businessId,
      customerId: ctx.customerId,
      serviceName: effectiveServiceName,
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

// ---------------------------------------------------------------------------
// Reschedule handler
// ---------------------------------------------------------------------------

async function handleReschedule(
  llmResult: GenerateReplyResult,
  ctx: BookingDecisionContext
): Promise<BookingDecisionResult> {
  // Persist slots so the next "yes 3pm works" is interpreted in context
  try {
    await updateConversationState(ctx.conversationId, {
      current_intent: 'reschedule',
      preferred_date: llmResult.preferred_date ?? undefined,
      preferred_time: llmResult.preferred_time ?? undefined,
    });
  } catch (e) {
    console.warn('[booking-decision] reschedule persist failed:', (e as Error).message);
  }

  // Need both date and time to attempt reschedule. If either is missing,
  // let the LLM's reply (asking for the missing piece) go through.
  if (!llmResult.preferred_date || !llmResult.preferred_time) {
    console.log('[booking-decision] reschedule SKIPPED — missing date/time');
    return { finalReply: llmResult.reply, appointment: null };
  }

  // Stage 16 — confirmation gate. If the LLM's reply is asking for
  // reconfirmation ("shall I proceed", "Confirming: ... Sahi?", etc.),
  // skip the destructive action and send the prompt to the customer.
  // The customer replies "haan kar do" on the next turn; the LLM then
  // returns intent=reschedule with the same slots but WITHOUT the
  // confirmation phrasing, and we execute here.
  if (isConfirmationPrompt(llmResult.reply)) {
    console.log('[booking-decision] reschedule AWAITING CONFIRMATION — skipping destructive action');
    return { finalReply: llmResult.reply, appointment: null };
  }

  try {
    // Pass the LLM-supplied service ONLY if it differs from the locked
    // one already in conversation state. Same string = no-op swap, so we
    // skip the extra DB lookup. The LLM's service-lock guard already
    // protects against partial-phrase swaps in processBookingDecision,
    // so by the time we get here, llmResult.service_interest is either
    // null or the canonical resolved name.
    const requestedService = llmResult.service_interest?.trim() || null;
    const outcome = await rescheduleAppointment({
      businessId: ctx.businessId,
      customerId: ctx.customerId,
      preferredDate: llmResult.preferred_date,
      preferredTime: llmResult.preferred_time,
      newServiceName: requestedService,
    });

    if (outcome.ok) {
      const newStart = new Date(outcome.newStart);
      const dateStr = newStart.toLocaleDateString('en-PK', {
        timeZone: 'Asia/Karachi',
        weekday: 'short', month: 'short', day: 'numeric',
      });
      const timeStr = newStart.toLocaleTimeString('en-PK', {
        timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true,
      });
      // Service line: when a swap happened, show "old → new" so the
      // customer can sanity-check the change visually.
      const serviceLine = outcome.serviceChanged
        ? `• Service: ${outcome.serviceName} (changed from your previous booking)`
        : `• Service: ${outcome.serviceName}`;
      return {
        finalReply:
          `✅ Rescheduled!\n\n` +
          `${serviceLine}\n` +
          `• New time: ${dateStr} at ${timeStr}\n` +
          `• Stylist: ${outcome.staffName}\n\n` +
          `See you then!`,
        appointment: null,
      };
    }

    // Failure — format per reason
    if (outcome.reason === 'no_upcoming_appointment') {
      return {
        finalReply: `You don't have any upcoming appointments to reschedule. Want to book a new one instead?`,
        appointment: null,
      };
    }
    if (outcome.reason === 'service_not_offered') {
      // Re-use the detail string db.ts built with "did you mean…?" so
      // the customer can correct themselves without another roundtrip.
      return {
        finalReply: outcome.detail,
        appointment: null,
      };
    }
    if (outcome.reason === 'slot_taken' && outcome.suggestions?.length) {
      return {
        finalReply:
          `Sorry — that new time isn't available. Other times that day: ` +
          outcome.suggestions.slice(0, 4).map((s) => s.slice(0, 5)).join(', ') +
          `. Reply with one of those to try again.`,
        appointment: null,
      };
    }
    return {
      finalReply: `Sorry — ${outcome.detail}. Could you pick a different day or time?`,
      appointment: null,
    };
  } catch (e) {
    console.error('[booking-decision] reschedule THREW:', (e as Error).message);
    return { finalReply: llmResult.reply, appointment: null };
  }
}

// ---------------------------------------------------------------------------
// Cancel handler
// ---------------------------------------------------------------------------

async function handleCancel(
  llmResult: GenerateReplyResult,
  ctx: BookingDecisionContext
): Promise<BookingDecisionResult> {
  try {
    await updateConversationState(ctx.conversationId, {
      current_intent: 'cancel',
    });
  } catch (e) {
    console.warn('[booking-decision] cancel persist failed:', (e as Error).message);
  }

  // Stage 16 — confirmation gate. Same as reschedule/book: if the LLM
  // is asking for reconfirmation, skip the destructive action.
  if (isConfirmationPrompt(llmResult.reply)) {
    console.log('[booking-decision] cancel AWAITING CONFIRMATION — skipping destructive action');
    return { finalReply: llmResult.reply, appointment: null };
  }

  try {
    const outcome = await cancelUpcomingAppointment(ctx.businessId, ctx.customerId);

    if (outcome.ok) {
      const when = outcome.when ? new Date(outcome.when) : null;
      const whenStr = when
        ? when.toLocaleString('en-PK', {
            timeZone: 'Asia/Karachi',
            weekday: 'short', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true,
          })
        : '';
      return {
        finalReply:
          `✅ Cancelled.\n\n` +
          `Your ${outcome.serviceName} appointment${whenStr ? ` for ${whenStr}` : ''} ` +
          `has been cancelled. Want to book a new one?`,
        appointment: null,
      };
    }

    if (outcome.reason === 'no_upcoming_appointment') {
      return {
        finalReply: `You don't have any upcoming appointments to cancel.`,
        appointment: null,
      };
    }

    return {
      finalReply: `Sorry — ${outcome.detail || "couldn't cancel right now"}. Please try again.`,
      appointment: null,
    };
  } catch (e) {
    console.error('[booking-decision] cancel THREW:', (e as Error).message);
    return { finalReply: llmResult.reply, appointment: null };
  }
}