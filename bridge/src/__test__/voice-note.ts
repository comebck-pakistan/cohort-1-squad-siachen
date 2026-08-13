// ---------------------------------------------------------------------------
// Voice-note test router — local-dev test seam for the voice-note path.
//
// Loaded ONLY when NODE_ENV !== 'production'. In production this module is
// not imported by index.ts, so the route is unreachable.
//
// What this gives us:
//   - Construct a fake msg-shaped object with controlled from / messageId /
//     duration / audio bytes.
//   - Drive it through the real handleVoiceNote() function with the same
//     VoiceNoteContext shape WhatsAppWebClient uses in production.
//   - If transcription succeeds, optionally call deliverInboundMessage to
//     hit the real backend and return the bot's reply.
//
// This is the test seam for the 13-case test matrix in the plan. A real
// WhatsApp device is not required.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import type { Message } from 'whatsapp-web.js';
import { childLogger } from '../logger';
import { deliverInboundMessage } from '../bridge-client';
import {
  handleVoiceNote,
  MessageDedupe,
  VoiceNoteRateLimit,
  type VoiceNoteContext,
  type VoiceNoteResult,
} from '../voice-note';

const log = childLogger('voice-note.test-router');

interface TestRequestBody {
  businessId?: string;
  messageId?: string;
  from?: string;
  durationSec?: number;
  mimetype?: string;
  base64Audio?: string;
  /** If true, skip deliverInboundMessage and return only the handler result. */
  transcribeOnly?: boolean;
}

export function createVoiceNoteTestRouter(): Router {
  const router = Router();

  // Self-contained state. Reset on router reload (each dev-server start).
  // Distinct from any WhatsAppWebClient instances — tests don't pollute
  // production dedupe/rate-limit state.
  const dedupe = new MessageDedupe(1000);
  const rateLimit = new VoiceNoteRateLimit();

  router.post('/voice-note', async (req: Request, res: Response) => {
    const body = (req.body || {}) as TestRequestBody;

    if (
      !body.businessId ||
      !body.messageId ||
      !body.from ||
      !body.base64Audio
    ) {
      return res.status(400).json({
        error:
          'missing required fields: businessId, messageId, from, base64Audio',
      });
    }

    // Construct a fake msg-shaped object. Only fields the handler reads:
    //   msg.type, msg.from, msg.hasMedia, msg.duration, msg.id.id,
    //   msg.downloadMedia()
    // Cast through unknown — the Message interface has many more fields the
    // handler doesn't read, and we don't want to mock all of them.
    const fakeMsg = {
      type: 'ptt' as const,
      from: body.from,
      hasMedia: true,
      duration: String(body.durationSec ?? 5),
      id: {
        id: body.messageId,
        fromMe: false,
        remote: body.from,
        _serialized: `fake:${body.messageId}`,
      },
      downloadMedia: async () => ({
        mimetype: body.mimetype ?? 'audio/ogg',
        data: body.base64Audio!,
        filename: null,
        filesize: null,
      }),
    } as unknown as Message;

    const ctx: VoiceNoteContext = {
      voiceNotesEnabled: process.env.ENABLE_VOICE_NOTES === 'true',
      // For tests we pretend the client is always ready — the test
      // runner controls timing.
      clientReady: true,
      dedupe,
      rateLimit,
      maxDurationSec: Number(process.env.MAX_VOICE_DURATION_SEC) || 120,
      groqApiKey: process.env.GROQ_API_KEY ?? '',
    };

    log.info(
      {
        businessId: body.businessId,
        messageId: body.messageId,
        from: body.from,
        transcribeOnly: !!body.transcribeOnly,
      },
      'voice_note_test_router_received'
    );

    const handlerResult: VoiceNoteResult = await handleVoiceNote(
      fakeMsg,
      body.businessId,
      ctx
    );

    if (!handlerResult.ok || body.transcribeOnly) {
      return res.json({ handlerResult, delivered: null });
    }

    // Pass the transcript through to the backend, mirroring what
    // WhatsAppWebClient.handleVoiceNoteMessage does. Retry loop identical
    // to deliverWithRetry but inlined here so we can return attempt
    // counts to the test caller.
    let reply: string | null = null;
    let attempts = 0;
    let lastError: Error | null = null;
    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 90_000;

    for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
      try {
        const result = await deliverInboundMessage(
          {
            businessId: body.businessId,
            from: body.from,
            text: handlerResult.text,
            messageId: body.messageId,
          },
          { timeoutMs: TIMEOUT_MS }
        );
        reply = result.reply;
        lastError = null;
        break;
      } catch (e) {
        lastError = e as Error;
        log.warn(
          { attempts, err: lastError.message },
          'voice_note_test_router_deliver_failed'
        );
        if (attempts < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    if (lastError) {
      return res.json({
        handlerResult,
        delivered: {
          reply: null,
          attempts,
          finalError: lastError.message,
        },
      });
    }

    return res.json({
      handlerResult,
      delivered: { reply, attempts },
    });
  });

  return router;
}