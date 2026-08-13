// ---------------------------------------------------------------------------
// Groq Whisper transcription.
//
// Endpoint: https://api.groq.com/openai/v1/audio/transcriptions
// Model:     whisper-large-v3-turbo  (best Urdu/English code-switch support)
//
// Uses global `FormData` (Node 18+) — no `form-data` npm dep. The audio file
// is sent as a Blob from the base64 `data` field of MessageMedia.
//
// Timeout is enforced via AbortSignal.timeout() passed to axios. Caller
// provides the budget — typically 30s for the first attempt + 15s for one
// retry (per the plan's 45s total voice-note budget).
//
// Typed errors:
//   - GroqAuthError:       401 — fail-fast (don't retry, burns quota)
//   - GroqRateLimitError:  429 with parsed Retry-After — retry once
//   - GroqTimeoutError:    request timeout (axios ECONNABORTED)
//   - GroqHttpError:       any other non-2xx
// ---------------------------------------------------------------------------

import axios, { AxiosError } from 'axios';
import type { MessageMedia } from 'whatsapp-web.js';

// ─── typed errors ──────────────────────────────────────────────────────────

export class GroqAuthError extends Error {
  readonly kind = 'auth' as const;
  constructor(message: string) {
    super(message);
    this.name = 'GroqAuthError';
  }
}

export class GroqRateLimitError extends Error {
  readonly kind = 'rate_limit' as const;
  readonly retryAfterSec: number | null;
  constructor(message: string, retryAfterSec: number | null) {
    super(message);
    this.name = 'GroqRateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}

export class GroqTimeoutError extends Error {
  readonly kind = 'timeout' as const;
  constructor(message: string) {
    super(message);
    this.name = 'GroqTimeoutError';
  }
}

export class GroqHttpError extends Error {
  readonly kind = 'http' as const;
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GroqHttpError';
    this.status = status;
  }
}

// ─── API ───────────────────────────────────────────────────────────────────

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

export interface TranscribeOptions {
  /** Total budget in ms. Aborts the request when exceeded. */
  totalBudgetMs: number;
  /** Optional AbortSignal — caller can chain to a parent abort. */
  signal?: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  model: string;
  latencyMs: number;
}

export async function transcribeAudio(
  media: MessageMedia,
  apiKey: string,
  options: TranscribeOptions
): Promise<TranscribeResult> {
  if (!apiKey) {
    throw new GroqAuthError('GROQ_API_KEY is empty — refusing to send');
  }
  if (!media?.data) {
    throw new GroqHttpError('MessageMedia has no data field', 0);
  }

  const startedAt = Date.now();

  // Convert base64 → Uint8Array → Blob for multipart upload. Going via Blob
  // (instead of streaming the buffer via the `file` field name with a
  // filename) keeps the code simple and works with axios's built-in
  // multipart serialization in Node 18+.
  const bytes = base64ToUint8Array(media.data);
  const blob = new Blob([bytes], {
    type: media.mimetype || 'audio/ogg',
  });

  // Build the multipart body using global FormData.
  const form = new FormData();
  form.append('file', blob, media.filename ?? 'voice.ogg');
  form.append('model', MODEL);
  // language param intentionally omitted → Whisper auto-detects. This gives
  // the best Urdu/English code-switch transcripts in our internal testing.
  // If prod evidence shows a single language wins, add it here.

  const signal = options.signal
    ? anySignal([AbortSignal.timeout(options.totalBudgetMs), options.signal])
    : AbortSignal.timeout(options.totalBudgetMs);

  let response;
  try {
    response = await axios.post(GROQ_ENDPOINT, form, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        // Do NOT set Content-Type — axios sets the correct multipart
        // boundary when the body is a FormData instance.
      },
      signal,
      // No explicit axios timeout — AbortSignal.timeout already enforces
      // it, and stacking two timeouts causes ECONNABORTED races.
      maxBodyLength: 50 * 1024 * 1024, // 50 MB hard cap on response body
      maxContentLength: 50 * 1024 * 1024,
      // Treat any 2xx-3xx as success; we throw ourselves on 4xx/5xx so
      // the error type is precise.
      validateStatus: (s) => s >= 200 && s < 300,
    });
  } catch (e) {
    throw mapAxiosError(e);
  }

  const latencyMs = Date.now() - startedAt;

  // Groq returns { text: "..." } for /audio/transcriptions. Don't trust
  // an unexpected shape — surface it as GroqHttpError so we dead-letter
  // loudly rather than send garbage downstream.
  const text = (response.data as { text?: unknown })?.text;
  if (typeof text !== 'string') {
    throw new GroqHttpError(
      `Unexpected Groq response shape: ${JSON.stringify(response.data).slice(0, 200)}`,
      200
    );
  }

  return { text, model: MODEL, latencyMs };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function base64ToUint8Array(b64: string): Uint8Array {
  // Buffer.from with 'base64' is the canonical Node API. Strip any leading
  // data:* MIME prefix defensively (MessageMedia.data is supposed to be
  // pure base64, but I've seen occasional library bugs that include it).
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

/**
 * Combine multiple AbortSignals into one — aborts when any source aborts.
 * Node 20+ has AbortSignal.any() built in; we wrap it for older Node.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), {
      once: true,
    });
  }
  return controller.signal;
}

function mapAxiosError(e: unknown): Error {
  const ax = e as AxiosError;
  // Aborted by signal → timeout (axios sets code='ERR_CANCELED' or
  // 'ABORTED' depending on version).
  if (
    ax?.code === 'ERR_CANCELED' ||
    ax?.code === 'ABORTED' ||
    ax?.name === 'CanceledError' ||
    ax?.name === 'AbortError'
  ) {
    return new GroqTimeoutError(
      `Groq transcription aborted: ${ax.message ?? 'unknown'}`
    );
  }
  // No response — network error (DNS, ECONNREFUSED, etc).
  if (!ax?.response) {
    return new GroqTimeoutError(
      `Groq network error: ${ax?.message ?? 'unknown'}`
    );
  }
  const status = ax.response.status;
  if (status === 401 || status === 403) {
    return new GroqAuthError(
      `Groq auth failed (${status}): ${JSON.stringify(ax.response.data).slice(0, 200)}`
    );
  }
  if (status === 429) {
    const retryAfter = parseRetryAfter(ax.response.headers?.['retry-after']);
    return new GroqRateLimitError(
      `Groq rate-limited (429); retry-after=${retryAfter ?? 'unknown'}`,
      retryAfter
    );
  }
  return new GroqHttpError(
    `Groq HTTP ${status}: ${JSON.stringify(ax.response.data).slice(0, 200)}`,
    status
  );
}

function parseRetryAfter(value: string | string[] | undefined): number | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) return sec;
  // Retry-After can also be an HTTP-date; for simplicity we ignore that
  // form — Groq uses seconds.
  return null;
}