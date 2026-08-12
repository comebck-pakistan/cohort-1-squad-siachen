import {
  getOrCreateCustomer,
  getOrCreateConversation,
  getConversationStateForPrompt,
  getUpcomingAppointmentForPrompt,
  getSalonContext,
  updateConversationState,
  touchConversation,
  recordEscalation,
  saveMessage,
  isAgentActive,
  updateCustomerNameIfMissing,
  isLidFormat,
  markConversationNeedsReviewLid,
  upsertCustomerChatId,
  detectMedicalConcern,
  isGroupChat,
} from './db';
import { isTrialExpired } from './trial';
import { generateReply, type BotIntent } from './llm';
import { processBookingDecision } from './booking';
import { postProcessReply } from './post-process';
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

  // Group-chat / non-personal-chat filter.
  //
  // whatsapp-web.js sometimes hands us group JIDs ("120363207662725526"
  // — bare 15-18 digit chat identifiers with no separator and no
  // @c.us / @lid suffix). These are NOT 1:1 customer messages; they're
  // messages from groups the bot was added to. Treating them as
  // customers polluted customers.phone with bridge-internal ids that
  // can't be used for outbound sends (Send button returned "No LID
  // for user" because these aren't user chatIds at all).
  //
  // Skip them at the entry: log, drop, return reply=null. The
  // transport layer treats reply=null as "don't send anything".
  // We never create a customer row, never start an LLM call, never
  // burn quota on a non-actionable message.
  if (isGroupChat(from)) {
    requestLog.info(
      { from },
      'group_chat_skipped — not a 1:1 customer message'
    );
    return {
      reply: null,
      conversationId: null,
      customerId: null,
      appointment: 'not_attempted',
    };
  }

  // Story 13 — owner pause. If the salon's AI is paused (agent_active=false),
  // still log the incoming customer message so the owner can see it in the
  // inbox, but skip the LLM entirely and return reply=null. The transport
  // treats null as "don't send anything back" — the customer sees nothing.
  // isAgentActive() is best-effort: if the DB lookup itself fails, we
  // fail-open (treat as active) so a transient DB hiccup doesn't silently
  // drop replies for an active salon.
  let agentPaused = false;
  try {
    agentPaused = !(await isAgentActive(businessId));
  } catch (e) {
    requestLog.warn(
      { err: (e as Error).message },
      'agent_active lookup failed — fail-open, treating as active',
    );
    agentPaused = false;
  }
  if (agentPaused) {
    try {
      // Resolve customer + conversation so the message lands in the right
      // thread. Skip updateConversationState (no LLM-extracted slots to
      // persist) but DO write the raw turn to messages so the owner sees
      // it in the inbox when they un-pause.
      const pausedCustomerId = await getOrCreateCustomer(customerPhone);
      const pausedConversationId = await getOrCreateConversation(businessId, pausedCustomerId);
      await saveMessage(pausedConversationId, 'customer', text);
      await touchConversation(pausedConversationId);
      requestLog.info(
        { conversationId: pausedConversationId },
        'ai_paused_skipping_reply',
      );
    } catch (e) {
      requestLog.warn(
        { err: (e as Error).message },
        'paused-mode message persistence failed (non-fatal)',
      );
    }
    return {
      reply: null,
      conversationId: null,
      customerId: null,
      appointment: 'not_attempted',
    };
  }

  // Wave 7 (Phase 2) — trial expiry. If the salon's 7-day free trial has
  // elapsed (trial_status='expired'), skip the LLM entirely and send a fixed
  // fallback message to the customer explaining the trial ended. This is
  // intentionally DIFFERENT from the agent-paused branch above:
  //
  //   - reply=null  → silence (paused: owner turned off the bot)
  //   - reply=text  → fixed fallback (expired: owner should know to upgrade)
  //
  // Silence for an expired trial looks like a broken product to the customer
  // ("did the salon block me?"), so we always reply with a clear, fixed
  // message that points them at the salon directly. The incoming customer
  // message is still persisted to the messages table — when the owner
  // upgrades and resumes the bot, she sees these conversations in her inbox.
  //
  // isTrialExpired() is best-effort: on any DB error it returns false so a
  // transient Supabase hiccup doesn't lock every salon out (fail-open,
  // matching isAgentActive's semantics above).
  let trialExpired = false;
  try {
    trialExpired = await isTrialExpired(businessId);
  } catch (e) {
    requestLog.warn(
      { err: (e as Error).message },
      'trial lookup failed — fail-open, treating as active',
    );
    trialExpired = false;
  }
  if (trialExpired) {
    let expCustomerId: string | null = null;
    let expConversationId: string | null = null;
    try {
      // Same pattern as the paused branch — persist customer + conversation
      // so the message lands in the right inbox thread, then write the raw
      // turn to messages so the owner sees it when she upgrades.
      expCustomerId = await getOrCreateCustomer(customerPhone);
      expConversationId = await getOrCreateConversation(businessId, expCustomerId);
      await saveMessage(expConversationId, 'customer', text);
      await touchConversation(expConversationId);
      requestLog.info(
        { conversationId: expConversationId },
        'trial_expired_sending_fallback',
      );
    } catch (e) {
      requestLog.warn(
        { err: (e as Error).message },
        'trial-expired message persistence failed (non-fatal)',
      );
    }

    const fixedReply =
      "This salon's Recepta free trial has ended. Please contact the salon directly to book an appointment, or message again after they upgrade their plan.";

    return {
      reply: fixedReply,
      conversationId: expConversationId,
      customerId: expCustomerId,
      appointment: 'not_attempted',
    };
  }

  requestLog.info({ textLength: text.length }, 'incoming message');

  let conversationId: string | null = null;
  let customerId: string | null = null;

  // Steps 1–3: customer lookup, conversation lookup, state update
  //
  // Hoisted outside the try: detectMedicalConcern(text) is also used by
  // postProcessReply (Stage 14) to decide whether to substitute the
  // medical-specific fallback. The check itself is cheap and best-effort
  // — failure is non-fatal and logged inside recordEscalation.
  const isMedicalConcern = detectMedicalConcern(text);

  try {
    customerId = await getOrCreateCustomer(customerPhone);
    conversationId = await getOrCreateConversation(businessId, customerId);

    // Step 1.5: LID-format detection. whatsapp-web.js sometimes hands
    // us a dash-separated identifier (e.g. "966541183544-1454589702")
    // instead of the normal "+ccphone@c.us" shape. Per team decision
    // (2026-08-07) we don't silently drop these — we flag them with a
    // dedicated escalation_events row so the owner sees them in the
    // Escalations tab with a "needs review" badge. The phone is still
    // stored as the normalized digits (via getOrCreateCustomer above)
    // so cross-customer uniqueness still works.
    //
    // Idempotent inside markConversationNeedsReviewLid(); safe to call
    // on every message turn from this customer. Best-effort — failure
    // here is non-fatal.
    if (isLidFormat(opts.from)) {
      await markConversationNeedsReviewLid(conversationId, opts.from);
    }

    // Step 1.5b: medical-concern detection — keyword/pattern check
    // that runs INDEPENDENTLY of the LLM. We don't trust the LLM to
    // reliably flag health-adjacent questions (it can bucket medical
    // intent under 'other' with high confidence). Whenever the
    // customer's text contains a clear symptom/safety phrase — allergic
    // reaction, pain/injury, pregnancy+service, skin/scalp/rash/
    // infection mentions, "is X safe for Y" — we create an escalation
    // row with reason='medical_concern' regardless of what the LLM
    // ends up returning. The bot's reply text still comes from the LLM
    // (which is told via the prompt to decline medical advice), but
    // the owner is now guaranteed to see the flag.
    //
    // recordEscalation() dedupes on (conversation_id, reason, resolved=false)
    // so repeated mentions across turns update one row instead of
    // creating a stream of duplicates. The customer's exact text is
    // stored in ai_draft_response so the owner can see what triggered
    // the alert when triaging.
    //
    // Best-effort — failure here is non-fatal, logged inside recordEscalation.
    //
    // The boolean result is also threaded into postProcessReply below so
    // that when the LLM's escalation reply is overridden (complaint
    // trigger disabled), the post-processor can substitute the
    // medical-specific fallback ("I can't diagnose, but I can book a
    // regular manicure") instead of the generic "tell me what you're
    // looking for" — which would read as a non-answer to a customer
    // describing a real symptom.
    //
    // Uses the outer `isMedicalConcern` declared above the try (hoisted
    // out so the LLM-call block can read it). If persistence failed and
    // we never got here, isMedicalConcern is still defined from the
    // initial check at line 328.
    if (isMedicalConcern) {
      await recordEscalation(conversationId, 'medical_concern', text);
      requestLog.info(
        { conversationId, textPreview: text.slice(0, 80) },
        'escalation recorded: medical_concern'
      );
    }

    // Step 1.6: persist the raw WhatsApp identifier (wa_chat_id) so
    // the owner-reply endpoint can route outbound sends back to the
    // same identifier scheme WhatsApp handed us. Both `@c.us` and
    // LID-format strings get written — only the SEND path needs the
    // LID case, but writing the @c.us case is harmless and keeps
    // the column consistent.
    //
    // Idempotent inside upsertCustomerChatId(); safe to call on
    // every turn. Best-effort.
    await upsertCustomerChatId(customerId, opts.from);

    await updateConversationState(conversationId, {
      last_customer_msg: text,
    });
    await touchConversation(conversationId);
    // Story 18 — also write the raw turn to the `messages` table so the
    // owner-facing inbox can render the chat log. Best-effort; failure
    // here is logged inside saveMessage() and does not break the reply.
    await saveMessage(conversationId, 'customer', text);

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
    // Also pull the customer's next upcoming appointment so the LLM
    // can disambiguate reschedule/cancel/clarification against ground
    // truth, not conversation_state guesswork. Falls back to a
    // placeholder when customerId wasn't created (persistence failed).
    const upcomingAppointmentPrompt = customerId
      ? await getUpcomingAppointmentForPrompt(businessId, customerId)
      : '## Upcoming appointment\n(unavailable — customer not yet persisted)';

    const llmResult = await generateReply({
      customerMessage: text,
      salonContext,
      conversationStatePrompt,
      upcomingAppointmentPrompt,
    });

    // Step 5b-prime: post-process the LLM reply.
    // The LLM has strong training priors that compete with our prompt:
    // "customer is upset → escalate" and "booking follow-up → mention a
    // date+time+service". When the owner has DISABLED escalation triggers
    // the LLM still escalates anyway; when there's no real booking the
    // LLM hallucinates specific dates and services. The post-processor
    // is a HARD GUARD that runs after the LLM and overrides these
    // behaviors. Only the post-processed reply is sent AND persisted —
    // raw LLM text never lands in messages, conversation_state, or
    // escalation_events (see Stage 11 persistence audit).
    //
    // Runs BEFORE escalation recording so the recorded ai_draft_response
    // reflects what the customer actually sees.
    const postProcessed = postProcessReply({
      reply: llmResult.reply,
      intent: llmResult.intent,
      enabledTriggers: salonContext.enabledTriggers,
      customerText: text,
      upcomingAppointmentContext: upcomingAppointmentPrompt,
      conversationStateContext: conversationStatePrompt,
      salonServiceNames: salonContext.services.map((s) => s.name),
      isMedicalConcern,
    });
    if (postProcessed.overridden) {
      requestLog.info(
        {
          originalIntent: llmResult.intent,
          finalIntent: postProcessed.intent,
          redactedSegments: postProcessed.redactedSegments,
        },
        '[post-process] reply overridden by guard'
      );
    }

    // Step 5b: escalation — record an escalation_events row when the
    // LLM flags intent='complaint' or when its confidence is so low
    // (and the intent isn't a booking action) that the salon owner
    // should probably step in. Dashboard reads from this table but
    // nothing was writing to it until now.
    //
    // Important: when the post-processor has already overridden the
    // intent (e.g. flipped 'complaint' → 'other' because triggers are
    // empty), we use the POST-PROCESSED intent + reply here. This
    // prevents the rejected LLM text from leaking into the escalation
    // row's ai_draft_response column.
    if (conversationId) {
      try {
        if (postProcessed.intent === 'complaint') {
          await recordEscalation(
            conversationId,
            'customer_complaint',
            postProcessed.reply
          );
          requestLog.info(
            { conversationId },
            'escalation recorded: customer_complaint'
          );
        } else if (
          llmResult.confidence < 30 &&
          !['book', 'cancel', 'reschedule'].includes(postProcessed.intent)
        ) {
          await recordEscalation(
            conversationId,
            'low_confidence',
            postProcessed.reply
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
    //
    // `effectiveLlmResult` carries the POST-PROCESSED reply and intent
    // through to the booking decision. If the post-processor overrode
    // the LLM's escalation language, the booking decision sees the
    // cleaned-up reply (so a confirmation summary chains onto "I'll
    // help you directly" rather than the rejected "Yeh sun ke...").
    // If the post-processor flipped intent from 'complaint' to
    // 'other', the booking decision treats it as a non-booking flow
    // (correct — escalation and booking are mutually exclusive).
    const effectiveLlmResult = {
      ...llmResult,
      reply: postProcessed.reply,
      // postProcessed.intent is a valid BotIntent: either the original
      // LLM-classified intent (already validated by clampIntent) or
      // 'other' (when Rule A overrides complaint → other). Cast to
      // satisfy processBookingDecision's typed parameter.
      intent: postProcessed.intent as BotIntent,
    };

    if (conversationId && customerId) {
      const decision = await processBookingDecision(effectiveLlmResult, {
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

      // Step 6b: persist the LLM-extracted customer_name to
      // customers.name — but ONLY if the column is currently empty.
      // The slot was already mirrored into conversation_state above;
      // this back-fills the human-readable display column that the
      // inbox list reads. Without it, the dashboard kept showing the
      // raw phone number as the display name even after the bot knew
      // the customer's name.
      //
      // Idempotent and non-overwriting by construction — see
      // updateCustomerNameIfMissing() in db.ts. Safe to call on
      // every turn; it short-circuits when the name already exists.
      if (llmResult.customer_name) {
        try {
          await updateCustomerNameIfMissing(customerId, llmResult.customer_name);
        } catch (e) {
          requestLog.warn(
            { err: (e as Error).message },
            'customer.name backfill failed (non-fatal)'
          );
        }
      }
    } else {
      // No conversation (persistence failed) — use the post-processed
      // LLM reply so we never send the raw (potentially escalated /
      // hallucinated) text even in degraded mode.
      finalReply = effectiveLlmResult.reply;
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
      // Story 18 — also write the agent turn to the `messages` table
      // so the inbox view renders it. saveMessage() is itself
      // best-effort and swallows its own errors.
      await saveMessage(conversationId, 'agent', finalReply);
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