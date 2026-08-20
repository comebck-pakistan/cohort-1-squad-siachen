import {
  getOrCreateCustomer,
  getOrCreateConversation,
  getConversationStateForPrompt,
  getUpcomingAppointmentForPrompt,
  getSalonContext,
  updateConversationState,
  touchConversation,
  recordEscalation,
  recordImageAnalysis,
  saveMessage,
  isAgentActive,
  isSubscriptionActive,
  updateCustomerNameIfMissing,
  isLidFormat,
  markConversationNeedsReviewLid,
  upsertCustomerChatId,
  detectMedicalConcern,
  isGroupChat,
} from './db';
import { isTrialExpired } from './trial';
import { generateReply, type BotIntent } from './llm';
import { analyzeImage } from './image-analysis';
import { processBookingDecision } from './booking';
import { postProcessReply } from './post-process';
import { childLogger } from './logger';
import { enforceMaintenance, FALLBACK_MAINTENANCE_MESSAGE } from './maintenance';

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
  /** The message body the customer sent. Required for text; for image
   *  messages with a caption it's the caption text; for image-only
   *  messages it can be empty string (we treat caption presence as
   *  optional metadata). */
  text: string;
  /**
   * Image media payload, when the customer sent an image instead of
   * (or alongside) text. Base64-encoded bytes plus MIME type. Set this
   * field when the transport knows the message has an image attachment;
   * the handler will route through image-analysis instead of the normal
   * text LLM call.
   *
   * NOT mutually exclusive with `text` — many WhatsApp images come
   * with a caption in `text`. We pass the caption through to the image
   * LLM as optional context.
   *
   * Why base64 (not a URL): we want the whole flow to run synchronously
   * inside the existing /api/bridge/inbound endpoint with no extra HTTP
   * hop. The bridge downloads the image via msg.downloadMedia() (which
   * returns base64) and forwards it inline. Matches the voice-note
   * pattern (the bridge forwards text transcripts inline today).
   */
  media?: {
    kind: 'image';
    /** Base64-encoded image bytes. With or without the `data:` URI prefix
     *  — the image-analysis helper strips it. */
    base64: string;
    /** MIME type, e.g. 'image/jpeg', 'image/png', 'image/webp'. */
    mimeType: string;
    /** Optional file size in bytes, for logging + audit. */
    filesize?: number;
  };
  /** WhatsApp message id (text) — surfaced into the image_analysis_logs
   *  row for cross-referencing the messages table. Optional. */
  messageId?: string;
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
  /** Appointment outcome from the booking decision layer, if any.
   *  Always 'not_attempted' for image messages — we don't try to book
   *  from a single image, only react to it. */
  appointment: 'created' | 'rejected' | 'not_attempted' | 'error';
  /** 'image' when this turn was routed through image-analysis,
   *  'text' (default) otherwise. Transports can use this for
   *  observability or routing decisions. */
  kind: 'text' | 'image';
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

  // Wave 18 — image branch.
  //
  // When the incoming message has image media attached (regardless of
  // whether there's also a caption in `text`), we route through the
  // image-analysis pipeline instead of the normal text LLM call. The
  // image LLM returns a structured classification + a draft reply
  // generated from the free-text image_description, so the bot sounds
  // specific to what the customer actually sent (not a generic template).
  //
  // IMPORTANT: this branch must come BEFORE the empty-text short-circuit
  // below — an image with no caption has empty `text` by design, and the
  // empty-text guard would otherwise drop it before image analysis runs.
  //
  // Pre-conditions checked BEFORE the agent-paused / trial-expired /
  // subscription-expired gates below:
  //   2. media.kind === 'image' (rejects voice notes / docs / stickers;
  //      those stay dropped at the transport for now)
  //
  // The group-chat filter (item 1) is checked FIRST — below this comment
  // — so group images don't burn image-LLM quota or pollute the customers
  // table. The order matters: a group image with no caption would hit
  // the image branch BEFORE the group filter, sending the LLM to work on
  // a non-actionable message.
  //
  // All other gates (agent-paused, trial-expired, subscription-expired)
  // are honored identically to the text path so the customer always
  // gets the same answer regardless of media type.

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
      kind: 'text',
    };
  }

  // Image branch — runs AFTER the group filter so group images are
  // dropped before any LLM call or DB write. The image path accepts an
  // empty caption (text.trim().length === 0 is a valid image-only
  // message), so this branch must come BEFORE the empty-text guard.
  // Pre-conditions checked before reaching here:
  //   1. group-chat filter (skipped groups, see above)
  //   2. (media.kind === 'image' — see conditional)
  //
  // All other gates (agent-paused, trial-expired, subscription-expired)
  // are honored inside handleIncomingImage identically to the text path.
  if (opts.media && opts.media.kind === 'image') {
    requestLog.info(
      {
        messageId: opts.messageId,
        mimeType: opts.media.mimeType,
        filesize: opts.media.filesize,
        captionLength: text?.trim().length ?? 0,
      },
      'image_received'
    );
    return handleIncomingImage(opts);
  }

  if (!text || text.trim().length === 0) {
    requestLog.warn('empty message text — skipping');
    return {
      reply: null,
      conversationId: null,
      customerId: null,
      appointment: 'not_attempted',
      kind: 'text',
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
      kind: 'text',
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
      kind: 'text',
    };
  }

  // Wave 13 — subscription gate. If subscription_status='expired' or
  // 'cancelled', behave like the trial-expired branch: persist the
  // customer turn so the owner sees it in the inbox, then send a fixed
  // fallback that points the customer at the salon directly. The fall
  // back is identical to the trial-expired case because the customer
  // experience is the same — bot is "off" because the subscription lapsed.
  let subscriptionExpired = false;
  try {
    subscriptionExpired = !(await isSubscriptionActive(businessId));
  } catch (e) {
    requestLog.warn(
      { err: (e as Error).message },
      'subscription_status lookup failed — fail-open, treating as active',
    );
    subscriptionExpired = false;
  }
  if (subscriptionExpired) {
    let subCustomerId: string | null = null;
    let subConversationId: string | null = null;
    try {
      subCustomerId = await getOrCreateCustomer(customerPhone);
      subConversationId = await getOrCreateConversation(businessId, subCustomerId);
      await saveMessage(subConversationId, 'customer', text);
      await touchConversation(subConversationId);
      requestLog.info(
        { conversationId: subConversationId },
        'subscription_expired_sending_fallback',
      );
    } catch (e) {
      requestLog.warn(
        { err: (e as Error).message },
        'subscription-expired message persistence failed (non-fatal)',
      );
    }

    const fixedReply =
      "This salon's Recepta subscription is currently inactive. Please contact the salon directly to book an appointment, or message again after they renew.";

    return {
      reply: fixedReply,
      conversationId: subConversationId,
      customerId: subCustomerId,
      appointment: 'not_attempted',
      kind: 'text',
    };
  }

  // Declared early so the maintenance gate (which mirrors the
  // agent_paused/subscription_expired persistence pattern) can read them.
  let customerId: string | null = null;
  let conversationId: string | null = null;

  // ────────────────────────────────────────────────────────────────────────
  // Step 3.5: Maintenance System Mode gate (superadmin-controlled kill
  // switch). This sits BEFORE the LLM call, BEFORE processBookingDecision,
  // and BEFORE every other DB mutation caused by the customer request. The
  // maintenance module is fail-closed — a resolver DB outage surfaces
  // FALLBACK_MAINTENANCE_MESSAGE rather than letting business operations
  // run unprotected.
  //
  // Mirrors the agent_paused / subscription_expired template above for
  // persistence behavior: customer + conversation + raw message are
  // written so the owner can read the inbound in the thread, and the
  // customer gets either the configured maintenance reply or null (when
  // their (salon, customer) pair is in the per-customer cooldown window).
  //
  // The maintenance gate covers BOTH text and image paths because the
  // check runs inside handleIncomingMessageInner (upstream of the image
  // fork). Image analysis (analyzeImage) is therefore unreachable while
  // maintenance is enabled.
  // ────────────────────────────────────────────────────────────────────────
  let maintenance = await enforceMaintenance({
    salonId: businessId,
    from,
  }).catch((e) => {
    requestLog.warn(
      { err: (e as Error).message },
      'maintenance enforce threw — treating as blocked (fail-closed)',
    );
    return {
      blocked: true,
      reply: FALLBACK_MAINTENANCE_MESSAGE,
      state: {
        enabled: true,
        scope: 'global' as const,
        bypassed: false,
        message: FALLBACK_MAINTENANCE_MESSAGE,
        cooldownMinutes: 30,
        startsAt: null,
        endsAt: null,
        windowId: null,
        inferred: true,
      },
      suppressedByCooldown: false,
    };
  });

  if (maintenance.blocked) {
    let maintenanceCustomerId: string | null = customerId;
    let maintenanceConversationId: string | null = conversationId;
    try {
      if (!maintenanceCustomerId) {
        maintenanceCustomerId = await getOrCreateCustomer(customerPhone);
      }
      if (!maintenanceConversationId) {
        maintenanceConversationId = await getOrCreateConversation(
          businessId,
          maintenanceCustomerId,
        );
      }
      await saveMessage(maintenanceConversationId, 'customer', text);
      await touchConversation(maintenanceConversationId);
    } catch (e) {
      requestLog.warn(
        { err: (e as Error).message },
        'maintenance-mode message persistence failed (non-fatal)',
      );
    }
    requestLog.info(
      {
        maintenance: {
          scope: maintenance.state.scope,
          windowId: maintenance.state.windowId,
          suppressedByCooldown: maintenance.suppressedByCooldown,
          inferred: maintenance.state.inferred,
        },
      },
      maintenance.suppressedByCooldown
        ? 'maintenance_response_suppressed'
        : 'maintenance_response_sent',
    );
    return {
      reply: maintenance.suppressedByCooldown ? null : maintenance.reply,
      customerId: maintenanceCustomerId,
      conversationId: maintenanceConversationId,
      appointment: 'not_attempted',
      kind: 'text',
    };
  }

  requestLog.info({ textLength: text.length }, 'incoming message');

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
    kind: 'text',
  };
}

// ---------------------------------------------------------------------------
// handleIncomingImage — Wave 18 (image branch).
//
// Called from handleIncomingMessage when opts.media.kind === 'image'. The
// text LLM is NOT involved here — instead we call analyzeImage() which
// delegates to MiniMax M3 (primary) → Gemini 2.5 Flash-Lite (fallback)
// → hard fallback message.
//
// Flow:
//   1. Resolve customer + conversation (same pattern as text path).
//   2. Persist a short marker row to `messages` so the inbox shows the
//      image turn (we don't write the raw image bytes there — the free-
//      text fields stay in image_analysis_logs).
//   3. Call analyzeImage() to get {classification, draft_reply,
//      escalate_to_human, ...}.
//   4. Persist the image_analysis_logs row.
//   5. Branch on classification:
//        - concern_or_complaint  → record escalation_events row +
//                                  return draft_reply
//        - service_reference     → return draft_reply (no escalation)
//        - unrelated_or_unclear  → if there's a caption, forward the
//                                  caption through the normal text LLM
//                                  call (handles the "send a photo with
//                                  a real question" case). Otherwise
//                                  return draft_reply.
//   6. Persist the agent reply + touch the conversation.
//
// Failure model: same as text path — persistence failures are non-fatal.
// analyzeImage() never throws; it returns a fallback on every error.
// ---------------------------------------------------------------------------

async function handleIncomingImage(
  opts: IncomingMessageOptions
): Promise<HandleResult> {
  const { businessId, from, text: captionOrEmpty } = opts;
  const customerPhone = normalizePhone(from);
  const requestLog = log.child({ businessId, customerPhone });

  // Step 1: resolve customer + conversation. Same persistence pattern as
  // the text path so the inbox shows the image turn and conversation_state
  // stays consistent.
  let customerId: string | null = null;
  let conversationId: string | null = null;
  try {
    customerId = await getOrCreateCustomer(customerPhone);
    conversationId = await getOrCreateConversation(businessId, customerId);

    if (isLidFormat(opts.from)) {
      await markConversationNeedsReviewLid(conversationId, opts.from);
    }
    await upsertCustomerChatId(customerId, opts.from);

    // Write a SHORT marker to the messages table so the inbox renders
    // an "[Image]" chip for this turn. We deliberately do NOT stash the
    // raw base64 in the messages.content column (no UI for rendering
    // it anyway). The free-text reasoning / classification / draft_reply
    // live in image_analysis_logs where the salon owner can read them
    // when triaging.
    await saveMessage(
      conversationId,
      'customer',
      '[Image — see image_analysis_logs]'
    );
    await touchConversation(conversationId);

    requestLog.debug(
      { conversationId, messageId: opts.messageId },
      'image persistence steps complete'
    );
  } catch (e) {
    requestLog.warn(
      { err: (e as Error).message },
      'image persistence step failed (continuing with analysis — degraded mode)'
    );
  }

  // Step 2: load the salon's service list so the image LLM can
  // distinguish in-scope photos from out-of-scope ones. Without this,
  // a hair photo sent to a nail-only salon produced "bring this photo,
  // our stylist can match" instead of a redirect. Same getSalonContext
  // call the text path uses; cost is identical.
  const salonContext = await getSalonContext(businessId).catch(() => null);

  // Step 3: run image analysis.
  const analysis = await analyzeImage({
    imageBase64: opts.media!.base64,
    mimeType: opts.media!.mimeType,
    caption: captionOrEmpty && captionOrEmpty.trim().length > 0 ? captionOrEmpty : undefined,
    salonName: salonContext?.name,
    salonServices: salonContext?.services,
  });

  // Step 3: persist the analysis row. Best-effort — never blocks the reply.
  await recordImageAnalysis({
    businessId,
    conversationId,
    customerId,
    messageId: opts.messageId ?? null,
    classification: analysis.classification,
    imageDescription: analysis.image_description,
    intentNotes: analysis.intent_notes,
    confidence: analysis.confidence,
    escalateToHuman: analysis.escalate_to_human,
    safetyNetTriggered: analysis.safety_net_triggered,
    draftReply: analysis.draft_reply,
    llmProvider: analysis.llm_provider,
    llmModel: analysis.llm_model,
    latencyMs: analysis.latency_ms,
    metadata: {
      mimeType: opts.media!.mimeType,
      filesize: opts.media!.filesize ?? null,
      captionLength:
        captionOrEmpty && captionOrEmpty.trim().length > 0
          ? captionOrEmpty.trim().length
          : 0,
    },
  });

  // Step 4: branch on classification.
  //
  // concern_or_complaint → record an escalation row + send the reply.
  // The escalation row uses reason='customer_complaint' (the existing
  // value from the EscalationReason enum) — it's the closest match and
  // already powers the Escalations tab UI. The full structured
  // classification (image_description, intent_notes) is preserved in
  // image_analysis_logs which the owner reads alongside the escalation.
  let finalReply: string = analysis.draft_reply;
  let appointmentStatus: HandleResult['appointment'] = 'not_attempted';

  if (
    analysis.classification === 'concern_or_complaint' &&
    conversationId &&
    analysis.escalate_to_human
  ) {
    try {
      await recordEscalation(
        conversationId,
        'customer_complaint',
        analysis.draft_reply
      );
      requestLog.info(
        { conversationId, classification: analysis.classification },
        'image_escalation_recorded'
      );
    } catch (e) {
      requestLog.warn(
        { err: (e as Error).message },
        'image escalation recording failed (non-fatal)'
      );
    }
  }

  // service_reference + unrelated_or_unclear (no caption): just return
  // the draft_reply. We've already analyzed the image; no LLM call to
  // chain into.
  //
  // unrelated_or_unclear + caption: the customer paired a photo with a
  // real question. We could just answer the caption as a text LLM call
  // — but that adds latency AND risks the LLM "hallucinating" that the
  // image is service-related. For MVP we treat this case as the same as
  // no-caption: send the draft_reply (the model already saw both image
  // AND caption when generating it). If we later want a text-chain
  // fallback, we can add it behind a flag.
  //
  // (Decision rationale: the model already had both inputs when producing
  // draft_reply, so chaining through the text LLM would be redundant
  // and noisy. Keeping it as a single LLM call keeps the pipeline fast.)

  // Step 5: persist the agent reply so the inbox shows it.
  if (conversationId) {
    try {
      await updateConversationState(conversationId, {
        last_customer_msg: captionOrEmpty
          ? `[Image${captionOrEmpty ? ` — "${captionOrEmpty.slice(0, 80)}"` : ''}]`
          : '[Image]',
        last_agent_msg: finalReply,
      });
      await touchConversation(conversationId);
      await saveMessage(conversationId, 'agent', finalReply);
    } catch (e) {
      requestLog.warn(
        { err: (e as Error).message },
        'image agent reply persistence failed (reply will still be sent)'
      );
    }
  }

  requestLog.info(
    {
      classification: analysis.classification,
      confidence: analysis.confidence,
      escalate_to_human: analysis.escalate_to_human,
      safety_net_triggered: analysis.safety_net_triggered,
      llm_provider: analysis.llm_provider,
      llm_model: analysis.llm_model,
      latency_ms: analysis.latency_ms,
      conversationId,
      customerId,
    },
    'image reply generated'
  );

  return {
    reply: finalReply,
    conversationId,
    customerId,
    appointment: appointmentStatus,
    kind: 'image',
  };
}