import {
  getOrCreateCustomer,
  getOrCreateConversation,
  getConversationStateForPrompt,
  getSalonContext,
  updateConversationState,
  touchConversation,
} from './db';
import { generateReply } from './llm';
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
// The transport layer's only job is:
//   (1) get the message IN (webhook payload vs library event)
//   (2) call handleIncomingMessage() with normalized fields
//   (3) send the reply back OUT (Meta API vs client.sendMessage)
//
// All business logic — customer/conversation lookup, state persistence,
// LLM call, error boundaries — lives here and is identical across paths.
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
 *   5. Generate LLM reply using state-aware prompt
 *   6. Persist agent reply into conversation_state (best-effort)
 *   7. Return reply text for the transport to send back
 *
 * Error model:
 *   - Persistence failures (steps 1-3, 6) are non-fatal — we still try to
 *     produce a reply. The bot degrades gracefully: it forgets the customer
 *     for this round but the conversation still flows.
 *   - LLM failures (step 5) are caught and replaced with a fallback message.
 *     Only catastrophic throws produce reply=null.
 *
 * Production-grade criterion: every step is logged with structured fields.
 * No silent errors.
 */
export async function handleIncomingMessage(
  opts: IncomingMessageOptions
): Promise<HandleResult> {
  const { businessId, from, text } = opts;
  const customerPhone = normalizePhone(from);

  // Per-request child logger so we can trace a single message through
  // the whole pipeline with one filter.
  const requestLog = log.child({ businessId, customerPhone });

  if (!text || text.trim().length === 0) {
    requestLog.warn('empty message text — skipping');
    return { reply: null, conversationId: null, customerId: null };
  }

  requestLog.info(
    { textLength: text.length },
    'incoming message'
  );

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

  // Steps 4–5: build context + generate reply
  let reply: string | null = null;
  try {
    const salonContext = await getSalonContext(businessId);
    const conversationStatePrompt = conversationId
      ? await getConversationStateForPrompt(conversationId)
      : '';

    reply = await generateReply({
      customerMessage: text,
      salonContext,
      conversationStatePrompt,
    });
  } catch (llmError) {
    requestLog.error(
      { err: (llmError as Error).message },
      'LLM generation failed; using fallback reply'
    );
    reply =
      'Sorry, I am having trouble responding right now. Please try again in a moment.';
  }

  // Step 6: persist agent reply (best-effort)
  if (conversationId && reply) {
    try {
      await updateConversationState(conversationId, {
        last_agent_msg: reply,
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
    { replyLength: reply?.length ?? 0, conversationId, customerId },
    'reply generated'
  );

  return {
    reply,
    conversationId,
    customerId,
  };
}