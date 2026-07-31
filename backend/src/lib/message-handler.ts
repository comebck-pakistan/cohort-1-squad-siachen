import {
  getOrCreateCustomer,
  getOrCreateConversation,
  getConversationStateForPrompt,
  getSalonContext,
  updateConversationState,
  touchConversation,
} from './db';
import { generateReply } from './llm';
import { processBookingDecision } from './booking';
import { childLogger } from './logger';

// ---------------------------------------------------------------------------
// Transport-agnostic message handler.
//
// This is the shared core that BOTH WhatsApp transports call into:
//
//   Meta Cloud API   (backend/src/routes/webhook.ts)
//     → calls handleIncomingMessage() after extracting from Meta's payload
//
//   whatsapp-web.js  (backend/src/whatsapp-web/client.ts)
//     → calls handleIncomingMessage() after the 'message' event fires
//
//   Demo widget      (backend/src/routes/demo.ts)
//     → calls handleIncomingMessage() to behave identically to production
//
// The transport layer's only job is:
//   (1) get the message IN (webhook payload vs library event vs HTTP body)
//   (2) call handleIncomingMessage() with normalized fields
//   (3) send the reply back OUT (Meta API vs client.sendMessage vs JSON)
//
// All business logic — customer/conversation lookup, state persistence,
// LLM call, booking decision, error boundaries — lives here and is
// identical across paths.
// ---------------------------------------------------------------------------

const log = childLogger('message-handler');

export interface IncomingMessageOptions {
  /** Which business this message belongs to (resolved by the transport). */
  businessId: string;
  /**
   * Customer's phone number, in whatever form the transport gives us.
   * Meta Cloud API sends:  "923001234567"            (raw digits + country code)
   * whatsapp-web.js sends: "923001234567@c.us"        (with @c.us suffix)
   * We normalize both into raw digits before using as a customer key.
   */
  from: string;
  /** The message body the customer sent. */
  text: string;
}

export interface HandleResult {
  /**
   * The reply text the bot wants to send back. Null only if LLM
   * generation itself failed AND the fallback message also failed.
   * Transports should treat null as "skip sending a reply".
   */
  reply: string | null;
  /** Conversation id used for this message, or null if persistence failed. */
  conversationId: string | null;
  /** Customer id used for this message, or null if persistence failed. */
  customerId: string | null;
  /** Appointment outcome from the booking decision layer, if any. */
  appointment: 'created' | 'rejected' | 'not_attempted' | 'error';
}

/**
 * Normalize the `from` field so both transports produce the same customer
 * phone key (raw digits, country code, no @-suffix).
 *
 * Examples:
 *   "923001234567"        → "923001234567"
 *   "923001234567@c.us"   → "923001234567"
 *   "923001234567@lid"    → "923001234567"
 */
function normalizePhone(raw: string): string {
  const atIndex = raw.indexOf('@');
  return atIndex === -1 ? raw : raw.substring(0, atIndex);
}

/**
 * Process an incoming customer message end-to-end.
 *
 * Flow:
 *   1. Resolve customer (by phone) — race-safe upsert
 *   2. Get-or-create conversation for (business, customer) — race-safe
 *   3. Persist incoming message into conversation_state (structured)
 *   4. Load salon context (services, hours, staff) + state prompt
 *   5. Generate structured LLM reply (intent + slots + reply_text)
 *   6. If intent='book' + all slots + confidence >= 50:
 *        → persist slots to state
 *        → call createAppointmentIfValid()
 *        → rewrite reply with confirmation or specific rejection
 *   7. Persist final agent reply into conversation_state (best-effort)
 *   8. Return reply text for the transport to send back
 *
 * Error model:
 *   - Persistence failures (steps 1-3, 7) are non-fatal — we still try to
 *     produce a reply. The bot degrades gracefully.
 *   - LLM failures (step 5) return the FALLBACK_RESULT inside llm.ts.
 *   - Booking failures (step 6) fall back to the LLM's conditional reply
 *     so the customer never sees a generic error.
 */
export async function handleIncomingMessage(
  opts: IncomingMessageOptions
): Promise<HandleResult> {
  const { businessId, from, text } = opts;
  const customerPhone = normalizePhone(from);

  const requestLog = log.child({ businessId, customerPhone });

  if (!text || text.trim().length === 0) {
    requestLog.warn('empty message text — skipping');
    return {
      reply: null,
      conversationId: null,
      customerId: null,
      appointment: 'not_attempted',
    };
  }

  requestLog.info({ textLength: text.length }, 'incoming message');

  let conversationId: string | null = null;
  let customerId: string | null = null;

  // Steps 1–3: customer lookup, conversation lookup, state update
  try {
    customerId = await getOrCreateCustomer(customerPhone);
    conversationId = await getOrCreateConversation(businessId, customerId);

    await updateConversationState(conversationId, {
      last_customer_msg: text,
    });
    await touchConversation(conversationId);

    requestLog.debug({ conversationId }, 'persistence steps complete');
  } catch (e) {
    requestLog.warn(
      { err: (e as Error).message },
      'persistence step failed; continuing with reply generation (degraded mode)'
    );
    // Continue — bot still replies, just without persistence this round.
  }

  // Steps 4–5: build context + generate structured LLM reply
  const fallback = 'Sorry, I am having trouble responding right now. Please try again in a moment.';
  let finalReply: string = fallback;
  let appointmentStatus: HandleResult['appointment'] = 'not_attempted';

  try {
    const salonContext = await getSalonContext(businessId);
    const conversationStatePrompt = conversationId
      ? await getConversationStateForPrompt(conversationId)
      : '';

    const llmResult = await generateReply({
      customerMessage: text,
      salonContext,
      conversationStatePrompt,
    });

    // Step 5b: persist the LLM's structured extraction to conversation_state.
    //
    // This is the architectural fix for "stale state" bugs. Previously
    // we only updated conversation_state on `book` intent attempts (via
    // persistBookingSlots in booking.ts), so any other intent — price
    // inquiry, greeting, hours question, etc. — left the state pointing
    // at whatever the LAST booking was, sometimes from hours or days ago.
    //
    // That caused the bot to book the wrong service (e.g. customer just
    // asked about Acrylic Full Set, but state still had Gel Manicure
    // from a 30-minute-old booking attempt, so "saturday 5 pm" got
    // attached to Gel Manicure).
    //
    // Now: every LLM call updates state with the LLM's latest extraction.
    //   - intent:        the LLM's understanding of this turn's goal
    //   - service_interest: what the customer is currently asking about
    //   - preferred_date/time: resolved dates and times
    //   - customer_name/phone: captured identity (if provided)
    //
    // We write null/empty values to clear stale state, because the LLM's
    // current understanding is the source of truth. If the customer says
    // "hi" and LLM returns service_interest=null, we WANT state cleared
    // — there's no ongoing service discussion.
    //
    // The prompt's "service extraction priority" rule then makes the next
    // turn's LLM call use this fresh state as authoritative when the
    // current message is ambiguous (e.g. "saturday 5 pm" with no service
    // mentioned uses state.service_interest = "Acrylic Full Set").
    if (conversationId) {
      try {
        await updateConversationState(conversationId, {
          current_intent:    llmResult.intent,
          service_interest:  llmResult.service_interest ?? undefined,
          preferred_date:    llmResult.preferred_date ?? undefined,
          preferred_time:    llmResult.preferred_time ?? undefined,
          customer_name:     llmResult.customer_name ?? undefined,
          customer_phone:    llmResult.customer_phone ?? undefined,
        });
        requestLog.debug(
          {
            intent:           llmResult.intent,
            service_interest: llmResult.service_interest,
            preferred_date:   llmResult.preferred_date,
            preferred_time:   llmResult.preferred_time,
            customer_name:    llmResult.customer_name,
          },
          'conversation_state synced from LLM output'
        );
      } catch (e) {
        requestLog.warn(
          { err: (e as Error).message },
          'failed to sync conversation_state from LLM (continuing)'
        );
      }
    }

    // Step 6: booking decision (only if we have a conversationId for state writes)
    if (conversationId && customerId) {
      const decision = await processBookingDecision(llmResult, {
        businessId,
        customerId,
        conversationId,
      });
      finalReply = decision.finalReply;
      if (decision.appointment) {
        appointmentStatus = decision.appointment.ok ? 'created' : 'rejected';
        requestLog.info(
          {
            appointmentId:
              'appointmentId' in decision.appointment
                ? decision.appointment.appointmentId
                : null,
            reason: decision.appointment.ok ? 'ok' : decision.appointment.reason,
          },
          'booking decision'
        );
      }
    } else {
      // No conversation (persistence failed) — use LLM reply verbatim
      finalReply = llmResult.reply;
    }
  } catch (e) {
    requestLog.error(
      { err: (e as Error).message },
      'reply generation failed; using fallback'
    );
    finalReply = fallback;
    appointmentStatus = 'error';
  }

  // Step 7: persist final agent reply (best-effort)
  if (conversationId) {
    try {
      await updateConversationState(conversationId, {
        last_agent_msg: finalReply,
      });
      await touchConversation(conversationId);
    } catch (e) {
      requestLog.warn(
        { err: (e as Error).message },
        'failed to persist agent reply (reply will still be sent)'
      );
    }
  }

  requestLog.info(
    {
      replyLength: finalReply.length,
      conversationId,
      customerId,
      appointment: appointmentStatus,
    },
    'reply generated'
  );

  return {
    reply: finalReply,
    conversationId,
    customerId,
    appointment: appointmentStatus,
  };
}