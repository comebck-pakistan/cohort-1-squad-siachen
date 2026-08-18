import axios from 'axios';

// ---------------------------------------------------------------------------
// Bridge → Core API HTTP client.
//
// The bridge service runs in its own process and has no in-process link to
// the core API's transport-agnostic business logic. Inbound WhatsApp messages
// from each salon's chromium are POSTed to /api/bridge/inbound on the main
// API; the reply text is sent back over the same channel.
//
// Service-to-service auth uses a shared secret in `X-Bridge-Token`. The main
// API rejects requests to /api/bridge/* without it.
//
// Both endpoints are documented in /home/vara/.claude/plans/cheerful-plotting-hamster.md
// (Phase 1).
// ---------------------------------------------------------------------------

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const BRIDGE_TOKEN = process.env.BRIDGE_INTERNAL_TOKEN || '';

const log = {
  warn: (msg: string, extra: Record<string, unknown> = {}) =>
    console.warn(`[bridge-client] ${msg}`, extra),
  error: (msg: string, extra: Record<string, unknown> = {}) =>
    console.error(`[bridge-client] ${msg}`, extra),
};

const http = axios.create({
  baseURL: BACKEND_URL,
  // No default timeout — callers specify per-call via options.timeoutMs.
  // We removed the 30s default because the bridge's retry loop now
  // passes tighter per-attempt timeouts (10s) so retries can complete
  // inside a reasonable budget. The old 30s default overrode any
  // per-call override and made retry useless.
  headers: {
    'X-Bridge-Token': BRIDGE_TOKEN,
    'Content-Type': 'application/json',
  },
});

/**
 * Fetch the list of business ids the main API considers "active" — meaning
 * their salons want a WhatsApp Web session running.
 *
 * Called once at bridge startup so we know which `WhatsAppWebClient`s to
 * construct up-front. Subsequent registrations (newly signed-up salons) flow
 * through the on-demand path `/onboarding/:id/register` proxied from the
 * frontend via the main API.
 */
export async function fetchActiveBusinesses(): Promise<string[]> {
  try {
    const { data } = await http.get<{ businessIds: string[] }>(
      '/api/bridge/active-businesses'
    );
    return Array.isArray(data?.businessIds) ? data.businessIds : [];
  } catch (e) {
    log.error('fetchActiveBusinesses failed', {
      err: (e as Error).message,
    });
    return [];
  }
}

export interface BridgeInboundMessage {
  businessId: string;
  from: string;
  text: string;
  messageId: string;
  /**
   * Optional image-media payload (Wave 18). When the customer sends an
   image over WhatsApp, the bridge downloads the bytes via
   `msg.downloadMedia()` (which returns base64 + mime type) and forwards
   them inline. No multipart, no separate endpoint — keeps the
   service-to-service contract identical to text.

   The base64 string MAY include the `data:` URI prefix or may be raw
   base64 — both are accepted by the backend. For very large images we
   could move this to multipart, but the existing 90s per-attempt
   timeout covers payloads up to ~5MB without trouble.
   */
  media?: {
    kind: 'image';
    base64: string;
    mimeType: string;
    filesize?: number;
  };
}

/**
 * Hand an inbound WhatsApp message off to the main API for the LLM/booking
 * pipeline, and return the reply the main API wants us to send back over
 * WhatsApp. Returns `reply: null` when the core pipeline says not to reply
 * (e.g. permission denied for a non-owner message); the caller should then
 * skip the send.
 *
 * Throws on transport failure (timeout, 5xx, auth-misconfigured) so the
 * caller can decide whether to retry. The main API returns 4xx for business
 * validation errors — those are surfaced as exceptions with the response
 * body's `error` field in the message.
 */
export interface DeliverOptions {
  /**
   * Per-call timeout in ms. Default: 10_000 (was 30_000 before the
   * retry loop was added). The retry loop in client.ts overrides this
   * to fit 3 attempts inside a reasonable budget.
   */
  timeoutMs?: number;
}

const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000;

export async function deliverInboundMessage(
  msg: BridgeInboundMessage,
  options: DeliverOptions = {}
): Promise<{ reply: string | null }> {
  const { data } = await http.post<{ reply: string | null }>(
    '/api/bridge/inbound',
    msg,
    { timeout: options.timeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS }
  );
  return { reply: data?.reply ?? null };
}
