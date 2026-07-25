import { Router, Request, Response } from 'express';
import { extractMessageFromWebhook, sendWhatsAppText } from '../lib/whatsapp';
import { getBusinessIdForPhoneNumberId } from '../lib/db';
import { handleIncomingMessage } from '../lib/message-handler';
import { childLogger } from '../lib/logger';

const log = childLogger('routes.webhook');

const router = Router();

// ---------------------------------------------------------------------------
// Meta Cloud API webhook.
//
// This is one of two transports (the other is whatsapp-web.js in
// src/whatsapp-web/). It does only transport-specific work:
//
//   1. Parse Meta's webhook payload
//   2. Resolve the salon via phone_number_id → business_id
//   3. Delegate to handleIncomingMessage() (shared core)
//   4. Send the returned reply via Meta's API
//
// All business logic — customer lookup, conversation_state, LLM call —
// lives in lib/message-handler.ts and is identical for both transports.
// ---------------------------------------------------------------------------

// Supabase configured? (env vars present). If not, we skip persistence
// AND we can't route messages to a salon, so we send a fallback reply.
function dbEnabled(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ---------------------------------------------------------------------------
// GET /webhook — Meta's verification handshake
// ---------------------------------------------------------------------------
router.get('/webhook', (req: Request, res: Response) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  log.info(
    {
      mode,
      tokenReceived: typeof token === 'string',
      tokenMatches: token === VERIFY_TOKEN,
    },
    'webhook verification handshake'
  );

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    log.info('webhook verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------------------------------------------------------------------------
// POST /webhook — incoming WhatsApp messages
// ---------------------------------------------------------------------------
router.post('/webhook', async (req: Request, res: Response) => {
  // Step 1 — ack Meta right away. Meta has a 5s timeout and retries
  // if we don't respond 200 immediately.
  res.sendStatus(200);

  try {
    // Step 2 — parse Meta's payload into {from, text, phoneNumberId}.
    const parsed = extractMessageFromWebhook(req.body);
    if (!parsed) return;
    const { from, text, phoneNumberId } = parsed;

    log.info(
      { from, phoneNumberId, textLength: text.length },
      'incoming whatsapp message'
    );

    // Step 3 — resolve salon from phone_number_id. Without this we
    // can't route to the right business and can't load its context.
    if (!dbEnabled()) {
      log.warn(
        'Supabase env vars missing; sending fallback reply'
      );
      await sendWhatsAppText({
        to: from,
        message:
          'Sorry, the salon is temporarily unavailable. Please try again later.',
      });
      return;
    }

    if (!phoneNumberId) {
      log.warn('no phone_number_id in webhook payload; cannot route');
      return;
    }

    const businessId = await getBusinessIdForPhoneNumberId(phoneNumberId);
    if (!businessId) {
      log.warn(
        { phoneNumberId },
        'no business claims this phone_number_id; message not routed'
      );
      return;
    }

    // Step 4 — delegate to shared message-handler. This does customer
    // lookup, conversation_state update, LLM call, agent reply persistence.
    // Failures inside the handler are isolated (it logs + still tries
    // to produce a reply) — we just send whatever reply it returns.
    const result = await handleIncomingMessage({
      businessId,
      from,
      text,
    });

    // Step 5 — send the reply via Meta's API.
    if (result.reply) {
      await sendWhatsAppText({ to: from, message: result.reply });
    }
  } catch (error) {
    log.error(
      { err: (error as Error).message },
      'webhook handler crashed'
    );
    // No ack to send — we already returned 200 in step 1.
  }
});

export default router;