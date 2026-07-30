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
  timeout: 30_000,
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
export async function deliverInboundMessage(
  msg: BridgeInboundMessage
): Promise<{ reply: string | null }> {
  const { data } = await http.post<{ reply: string | null }>(
    '/api/bridge/inbound',
    msg
  );
  return { reply: data?.reply ?? null };
}
