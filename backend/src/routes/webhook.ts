import { Router, Request, Response } from 'express';
import { extractMessageFromWebhook, sendWhatsAppText } from '../lib/whatsapp';
import { generateReply } from '../lib/llm';
import {
  getBusinessIdForPhoneNumberId,
  getOrCreateCustomer,
  getOrCreateConversation,
  getConversationStateForPrompt,
  getSalonContext,
  updateConversationState,
  touchConversation,
} from '../lib/db';

const router = Router();

// Supabase configured? (env vars present). If not, we still respond to
// Meta and call the LLM — we just skip persistence. Lets the dev keep
// iterating without a DB up yet.
function dbEnabled(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ---------------------------------------------------------------------------
// GET /webhook — Meta's verification handshake
// ---------------------------------------------------------------------------
router.get('/webhook', (req: Request, res: Response) => {
  // Read env var INSIDE the handler so we always get the current value,
  // even if dotenv loads after this module is first imported.
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(
    `[webhook GET] mode=${mode} token_received=${token} token_expected=${VERIFY_TOKEN}`
  );

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------------------------------------------------------------------------
// POST /webhook — incoming WhatsApp messages
// ---------------------------------------------------------------------------
//
// Flow:
//   1. Respond 200 immediately (Meta has a 5s timeout, otherwise it retries).
//   2. Parse the incoming message + extract phone_number_id.
//   3. Route via businesses table (phone_number_id → business_id).
//      Any customer can message us — we don't pre-map customer phones.
//   4. Get-or-create the customer (by `from` phone) + conversation.
//   5. Save the incoming customer message into structured state.
//   6. Ask the LLM for a reply using the structured state as context.
//   7. Save the agent's reply into structured state.
//   8. Send the reply back via Meta's API.
//
// (Migration 2026-07-22: raw messages are no longer persisted. The bot
//  reads/writes structured conversation_state instead.)
//
router.post('/webhook', async (req: Request, res: Response) => {
  // Step 1 — ack Meta right away
  res.sendStatus(200);

  try {
    // Step 2 — parse
    const parsed = extractMessageFromWebhook(req.body);
    if (!parsed) return;
    const { from, text, phoneNumberId } = parsed;
    console.log(`Message from ${from} (via phone_number_id=${phoneNumberId}): ${text}`);

    let conversationId: string | null = null;
    let businessId: string | null = null;

    // Steps 3–5 — persistence (skipped if Supabase not configured)
    if (dbEnabled()) {
      try {
        if (!phoneNumberId) {
          console.warn('No phone_number_id in webhook payload — cannot route');
          return;
        }

        // Step 3 — route to the salon that owns this WhatsApp number
        businessId = await getBusinessIdForPhoneNumberId(phoneNumberId);
        if (!businessId) {
          console.warn(
            `No business claims phone_number_id=${phoneNumberId} — message not routed`
          );
          return;
        }

        // Step 4 — get-or-create customer + conversation
        const customerId = await getOrCreateCustomer(from);
        conversationId = await getOrCreateConversation(businessId, customerId);

        // Step 5 — record the incoming customer message as structured state
        await updateConversationState(conversationId, {
          last_customer_msg: text,
        });
        await touchConversation(conversationId);
      } catch (dbError) {
        // Persistence failures shouldn't kill the reply path.
        console.warn(
          'Supabase write skipped (continuing to reply):',
          (dbError as Error).message
        );
        conversationId = null;
      }
    } else {
      console.warn('Supabase env vars missing — skipping persistence');
    }

    // Step 6 — generate reply (LLM falls back to placeholder if it fails)
    let replyMessage: string;
    try {
      // Load this salon's services + hours so the LLM answers with real data.
      // businessId is set in step 3 (Supabase routing above). If Supabase
      // is disabled, we pass an empty context — the LLM will gracefully say
      // "owner is still setting up" rather than guessing.
      const salonContext = businessId
        ? await getSalonContext(businessId)
        : {
            business_id: '',
            name: 'our salon',
            city: null,
            timezone: 'Asia/Karachi',
            services: [],
            hours: [],
            staff_count: 0,
            is_configured: false,
          };
      // Load structured conversation state. Replaces old
      // `getRecentMessages(...)` history threading. The LLM now uses
      // structured slots (intent, service, date, time, name, phone)
      // plus the last exchange lines for tone.
      const conversationStatePrompt = conversationId
        ? await getConversationStateForPrompt(conversationId)
        : '';
      replyMessage = await generateReply({
        customerMessage: text,
        salonContext,
        conversationStatePrompt,
      });
    } catch (llmError) {
      console.error('LLM error, using fallback:', llmError);
      replyMessage = 'Thanks for your message. We will get back to you shortly.';
    }

    // Step 7 — record the agent's reply in structured state (best-effort)
    if (conversationId) {
      try {
        await updateConversationState(conversationId, {
          last_agent_msg: replyMessage,
        });
        await touchConversation(conversationId);
      } catch (saveErr) {
        console.warn('Failed to save agent reply:', (saveErr as Error).message);
      }
    }

    // Step 8 — send via WhatsApp
    await sendWhatsAppText({ to: from, message: replyMessage });
  } catch (error) {
    console.error('Webhook handler error:', error);
  }
});

export default router;
