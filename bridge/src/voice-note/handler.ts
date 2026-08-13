// ---------------------------------------------------------------------------
// handleVoiceNote — orchestrator for the voice-note path.
//
// Flow (matches the architecture diagram in the plan):
//   1. Pre-checks: enabled flag, msg.from, group-chat, client ready, hasMedia
//   2. Size + duration caps (reject pre-Groq)
//   3. Dedupe (LRU on messageId)
//   4. Rate-limit (per-phone sliding window)
//   5. Download media via msg.downloadMedia()
//   6. Transcribe via Groq (with total budget)
//   7. Validate transcript (length, noise tokens)
//   8. Return discriminated result for the caller to act on
//
// Caller (WhatsAppWebClient.handleVoiceNoteMessage) decides what to do with
// each skip reason: drop silently, dead-letter log, or send a clarification
// text via sendTextMessage(). Keeping the policy decision out of this module
// makes it pure and testable.
// ---------------------------------------------------------------------------

import type { Message } from 'whatsapp-web.js';
import { childLogger } from '../logger';
import { isGroupChat } from './group-chat';
import { isValidTranscript } from './validate';
import { MessageDedupe } from './dedupe';
import { VoiceNoteRateLimit } from './rate-limit';
import {
  transcribeAudio,
  GroqAuthError,
  GroqHttpError,
  GroqRateLimitError,
  GroqTimeoutError,
} from './groq-whisper';

const log = childLogger('voice-note.handler');

// Groq's per-file size limit is 25MB. We use a slightly lower cap to leave
// headroom for base64 inflation (4/3) inside the multipart body.
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

// Total voice-note budget cap. Plan says 45s (30s first attempt + 15s retry).
// Implemented as a single AbortSignal budget for the whole transcribe call;
// if we need a single retry we accept that the second attempt reuses the
// remaining budget. For v1 we keep it simple — no internal retry loop here.
const TOTAL_TRANSCRIBE_BUDGET_MS = 45_000;

// ─── public types ──────────────────────────────────────────────────────────

export interface VoiceNoteContext {
  /** Whether ENABLE_VOICE_NOTES is on for this bridge deploy. */
  voiceNotesEnabled: boolean;
  /** Whether the WhatsAppWebClient is in 'ready' status. */
  clientReady: boolean;
  /** LRU dedupe store on message ids. */
  dedupe: MessageDedupe;
  /** Per-phone sliding-window rate limiter. */
  rateLimit: VoiceNoteRateLimit;
  /** Hard cap on voice note duration in seconds. */
  maxDurationSec: number;
  /** Groq API key. Empty string disables transcription (we still log). */
  groqApiKey: string;
}

export type VoiceNoteSkipReason =
  | 'disabled'
  | 'no_from'
  | 'group_chat'
  | 'not_ready'
  | 'no_media'
  | 'too_short'
  | 'too_long'
  | 'too_large'
  | 'dedupe_hit'
  | 'rate_limited'
  | 'empty_or_noise'
  | 'download_failed'
  | 'transcribe_failed';

export type VoiceNoteResult =
  | {
      ok: true;
      text: string;
      latencyMs: number;
      model: string;
      durationSec: number;
      filesize: number;
    }
  | {
      ok: false;
      reason: VoiceNoteSkipReason;
      message: string;
    };

// ─── orchestrator ──────────────────────────────────────────────────────────

export async function handleVoiceNote(
  msg: Message,
  businessId: string,
  ctx: VoiceNoteContext
): Promise<VoiceNoteResult> {
  const logCtx = log.child({
    businessId,
    from: msg.from,
    messageId: msg.id?.id,
    msgType: msg.type,
  });

  // 1. Feature flag
  if (!ctx.voiceNotesEnabled) {
    logCtx.debug('voice_notes_disabled_drop');
    return { ok: false, reason: 'disabled', message: 'voice notes disabled' };
  }

  // 2. Sanity: msg.from must be present.
  if (!msg.from) {
    logCtx.debug('voice_note_no_from_drop');
    return { ok: false, reason: 'no_from', message: 'msg.from is empty' };
  }

  // 3. Group-chat pre-filter (avoids Groq calls for group voice notes).
  if (isGroupChat(msg.from)) {
    logCtx.info('voice_note_group_skipped');
    return {
      ok: false,
      reason: 'group_chat',
      message: 'group chat voice note — dropped at bridge',
    };
  }

  // 4. Client must be ready for media download.
  if (!ctx.clientReady) {
    logCtx.info('voice_note_during_init_drop');
    return {
      ok: false,
      reason: 'not_ready',
      message: 'client not ready',
    };
  }

  // 5. Must have media + non-trivial duration.
  if (!msg.hasMedia) {
    logCtx.debug('voice_note_no_media_drop');
    return {
      ok: false,
      reason: 'no_media',
      message: 'msg.hasMedia is false',
    };
  }

  // msg.duration is a STRING (per whatsapp-web.js types). Parse defensively.
  const durationSec = parseFloat(msg.duration ?? '0') || 0;
  if (durationSec < 1) {
    logCtx.info({ durationSec }, 'voice_note_too_short_drop');
    return {
      ok: false,
      reason: 'too_short',
      message: `duration=${durationSec}s below 1s floor`,
    };
  }
  if (durationSec > ctx.maxDurationSec) {
    logCtx.info({ durationSec, cap: ctx.maxDurationSec }, 'voice_note_too_long_drop');
    return {
      ok: false,
      reason: 'too_long',
      message: `duration=${durationSec}s exceeds cap ${ctx.maxDurationSec}s`,
    };
  }

  // 6. Dedupe.
  if (ctx.dedupe.seenBefore(msg.id.id)) {
    logCtx.info('voice_note_dedupe_hit');
    return {
      ok: false,
      reason: 'dedupe_hit',
      message: 'duplicate messageId',
    };
  }

  // 7. Rate limit.
  if (!ctx.rateLimit.allow(msg.from)) {
    logCtx.info(
      { cap: ctx.rateLimit.count(msg.from) },
      'voice_note_rate_limited'
    );
    return {
      ok: false,
      reason: 'rate_limited',
      message: 'per-phone rate limit exceeded',
    };
  }

  // 8. Download.
  let media;
  try {
    media = await msg.downloadMedia();
  } catch (e) {
    // whatsapp-web.js sometimes throws non-Error values (strings, custom
    // objects). `(e as Error).message` collapses to garbage like "r" when
    // the throw isn't a real Error. Capture everything we can.
    const errDump = errorToLogFields(e);
    logCtx.warn(
      {
        ...errDump,
        mediaKey: msg.mediaKey ? 'present' : 'missing',
        hasMedia: msg.hasMedia,
        msgType: msg.type,
      },
      'voice_note_download_failed'
    );
    return {
      ok: false,
      reason: 'download_failed',
      message: `downloadMedia threw: ${errDump.errString}`,
    };
  }

  if (!media?.data) {
    logCtx.warn('voice_note_download_empty');
    return {
      ok: false,
      reason: 'download_failed',
      message: 'downloadMedia returned empty media',
    };
  }

  // Filesize cap (post-download, since msg doesn't carry filesize for
  // voice notes in some library versions).
  const filesize = media.filesize ?? estimateBase64Size(media.data);
  if (filesize > MAX_AUDIO_BYTES) {
    logCtx.info({ filesize }, 'voice_note_too_large_drop');
    return {
      ok: false,
      reason: 'too_large',
      message: `filesize=${filesize} exceeds ${MAX_AUDIO_BYTES}`,
    };
  }

  // 9. Transcribe.
  if (!ctx.groqApiKey) {
    logCtx.error('voice_note_transcribe_skipped_no_key');
    return {
      ok: false,
      reason: 'transcribe_failed',
      message: 'GROQ_API_KEY not configured',
    };
  }

  let transcript;
  try {
    transcript = await transcribeAudio(media, ctx.groqApiKey, {
      totalBudgetMs: TOTAL_TRANSCRIBE_BUDGET_MS,
    });
  } catch (e) {
    const kind =
      e instanceof GroqAuthError
        ? 'auth_error_fail_fast'
        : e instanceof GroqRateLimitError
          ? 'rate_limit_error'
          : e instanceof GroqTimeoutError
            ? 'timeout_error'
            : e instanceof GroqHttpError
              ? `http_error_${e.status}`
              : 'unknown_error';
    logCtx.warn(
      {
        ...errorToLogFields(e),
        kind,
      },
      'voice_note_transcribe_failed'
    );
    return {
      ok: false,
      reason: 'transcribe_failed',
      message: `${kind}: ${errorToLogFields(e).errString}`,
    };
  }

  logCtx.info(
    {
      transcriptLength: transcript.text.length,
      groqLatencyMs: transcript.latencyMs,
      model: transcript.model,
    },
    'voice_note_transcribed'
  );

  // 10. Validate transcript.
  if (!isValidTranscript(transcript.text)) {
    logCtx.info(
      {
        textPreview: transcript.text.slice(0, 80),
      },
      'voice_note_empty_or_noise_transcript'
    );
    return {
      ok: false,
      reason: 'empty_or_noise',
      message: 'transcript failed isValidTranscript',
    };
  }

  return {
    ok: true,
    text: transcript.text,
    latencyMs: transcript.latencyMs,
    model: transcript.model,
    durationSec,
    filesize,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function estimateBase64Size(b64: string): number {
  // Base64 inflates by 4/3, with optional padding. Use length / 4 * 3 as
  // an upper bound.
  return Math.ceil((b64.length * 3) / 4);
}

/**
 * Best-effort extraction of error fields for structured logging.
 *
 * whatsapp-web.js, axios, and node-fetch sometimes throw strings, custom
 * error classes with weird shapes, or objects where `.message` is a
 * single character (e.g. "r"). Naive `(e as Error).message` collapses
 * those to garbage. We capture everything we can:
 *
 *   - errString:    String(e) — always defined, never throws
 *   - errMessage:   e?.message if it's a real Error
 *   - errType:      constructor name
 *   - errCode:      e?.code if present (axios uses this)
 *   - errStack:     truncated stack trace
 */
function errorToLogFields(e: unknown): {
  errString: string;
  errMessage: string;
  errType: string;
  errCode?: string;
  errStack?: string;
} {
  const errString = (() => {
    try {
      return String(e);
    } catch {
      return '<unstringifiable>';
    }
  })();

  if (e instanceof Error) {
    return {
      errString,
      errMessage: e.message,
      errType: e.name || e.constructor.name,
      errCode: (e as Error & { code?: string }).code,
      errStack: e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : undefined,
    };
  }

  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    return {
      errString,
      errMessage: typeof obj.message === 'string' ? obj.message : errString,
      errType: obj.constructor?.name ?? 'object',
      errCode: typeof obj.code === 'string' ? obj.code : undefined,
    };
  }

  return {
    errString,
    errMessage: errString,
    errType: typeof e,
  };
}