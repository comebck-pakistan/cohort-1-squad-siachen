import {
  getOrCreateCustomer,
  getOrCreateConversation,
  getConversationStateForPrompt,
  getSalonContext,
  updateConversationState,
  touchConversation,
  recordEscalation,
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

// ---------------------------------------------------------------------------
// Per-conversation serialization lock.
//
// WhatsApp can deliver two messages from the same customer back-to-back
// (e.g. "hi" then "what services do you offer" sent 2s apart). Without
// serialization, both calls to handleIncomingMessage run concurrently,
// both read the same conversation_state, both call the LLM, and the
// responses can land in the wrong order — the customer sees the second
// message's reply attached to the first question.
//
// This Map<customerKey, Promise> chains every call for the same customer
// so they run strictly in order. Calls for DIFFERENT customers still run
// in parallel. Latency cost is per-customer, not global — adds delay
// only when the same person double-texts fast, which is exactly the case
// we're fixing correctness for.
//
// In-process only. If we ever run multiple backend replicas, this needs
// to move to a Redis-backed lock. Single backend process per environment
// for now, so this is sufficient.
// ---------------------------------------------------------------------------

const inflightByCustomer = new Map<string, Promise<unknown>>();

async function withCustomerLock<T>(
  customerKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = inflightByCustomer.get(customerKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  inflightByCustomer.set(customerKey, next);
  try {
    return await next;
  } finally {
    if (inflightByCustomer.get(customerKey) === next) {
      inflightByCustomer.delete(customerKey);
    }
  }
}

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
  // Per-customer serialization: see withCustomerLock above. We use
  // businessId + normalized phone as the lock key so calls from the
  // same (business, customer) chain in order, while different
  // customers still run in parallel.
  const customerKey = `${opts.businessId}:${normalizePhone(opts.from)}`;
  return withCustomerLock(customerKey, () => handleIncomingMessageInner(opts));
}

async function handleIncomingMessageInner(
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

    // Step 5b: escalation — record an escalation_events row when the
    // LLM flags intent='complaint' or when its confidence is so low
    // (and the intent isn't a booking action) that the salon owner
    // should probably step in. Dashboard reads from this table but
    // nothing was writing to it until now.
    if (conversationId) {
      try {
        if (llmResult.intent === 'complaint') {
          await recordEscalation(
            conversationId,
            'customer_complaint',
            llmResult.reply
          );
          requestLog.info(
            { conversationId },
            'escalation recorded: customer_complaint'
          );
        } else if (
          llmResult.confidence < 30 &&
          !['book', 'cancel', 'reschedule'].includes(llmResult.intent)
        ) {
          await recordEscalation(
            conversationId,
            'low_confidence',
            llmResult.reply
          );
          requestLog.info(
            { conversationId, confidence: llmResult.confidence },
            'escalation recorded: low_confidence'
          );
        }
      } catch (e) {
        // Non-fatal — escalation logging shouldn't break the reply.
        requestLog.warn(
          { err: (e as Error).message },
          'escalation recording failed (non-fatal)'
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