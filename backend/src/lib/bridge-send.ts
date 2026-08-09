// ---------------------------------------------------------------------------
// Bridge send helper — Wave 7 (Phase 4).
//
// Wraps the bridge's `POST /onboarding/:businessId/send` endpoint
// (bridge/src/qr-server.ts:362-415). Conversation-agnostic — accepts
// any {to, text} pair. Used by:
//
//   - owner-reply endpoint (dashboard.ts) — replies in an existing thread
//   - trial-notify (lib/trial-notify.ts) — sends headless warning to the
//     owner before their trial expires
//
// Returning a uniform shape lets the cron job log + skip failures without
// crashing, while the owner-reply caller can still surface 502s with
// detailed diagnostics to the UI.
// ---------------------------------------------------------------------------

import axios, { AxiosError, Method } from 'axios';
import { childLogger } from './logger';

const log = childLogger('bridge-send');

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3100';
const BRIDGE_TOKEN = process.env.BRIDGE_INTERNAL_TOKEN || '';

export interface BridgeSendResult {
  /** True when the bridge accepted the send (2xx response). */
  ok: boolean;
  /** False when the send didn't reach WhatsApp. Diagnostic info attached. */
  sentToBridge: boolean;
  /** Stable id for tracking — currently always null since the bridge doesn't
   *  return a messageId yet, but the field exists so callers can log it. */
  messageId: string | null;
  /** When the bridge returns non-2xx, the HTTP status it sent. */
  bridgeStatus?: number;
  /** When the bridge returns non-2xx, the parsed response body. */
  bridgeBody?: unknown;
  /** When bridge is unreachable / misconfigured / etc. */
  error?: string;
}

export interface BridgeSendOptions {
  /** Override the default 10s timeout. Trial-notify uses 30s since it's
   *  not user-blocking. */
  timeoutMs?: number;
}

/**
 * Send a WhatsApp message via the bridge from the salon's paired phone.
 *
 * @param businessId  The salon's id — bridge routes to the right
 *                    WhatsAppWebClient instance.
 * @param to          Customer-facing chat id (e.g. "923001234567" or
 *                    "923001234567@c.us" or a raw LID). The bridge's
 *                    client.sendTextMessage auto-appends @c.us if missing.
 * @param text        Message body.
 */
export async function bridgeSend(
  businessId: string,
  to: string,
  text: string,
  options: BridgeSendOptions = {},
): Promise<BridgeSendResult> {
  if (!BRIDGE_TOKEN || !BRIDGE_URL) {
    log.warn(
      { businessId },
      'bridge-send: bridge not configured (BRIDGE_URL / BRIDGE_INTERNAL_TOKEN missing)',
    );
    return {
      ok: false,
      sentToBridge: false,
      messageId: null,
      error: 'bridge service not configured',
    };
  }

  try {
    const response = await axios({
      method: 'post' as Method,
      url: `${BRIDGE_URL}/onboarding/${businessId}/send`,
      headers: {
        'X-Bridge-Token': BRIDGE_TOKEN,
        'Content-Type': 'application/json',
      },
      data: { to, text },
      validateStatus: () => true,
      timeout: options.timeoutMs ?? 10_000,
    });

    if (response.status >= 200 && response.status < 300) {
      log.info(
        { businessId, to, textLength: text.length },
        'bridge-send delivered',
      );
      return { ok: true, sentToBridge: true, messageId: null };
    }

    log.error(
      { businessId, to, status: response.status, body: response.data },
      'bridge-send: bridge returned non-2xx',
    );
    return {
      ok: false,
      sentToBridge: false,
      messageId: null,
      bridgeStatus: response.status,
      bridgeBody: response.data,
      error: `bridge send failed: ${response.status}`,
    };
  } catch (e) {
    const err = e as AxiosError;
    log.error(
      { businessId, to, err: err.message },
      'bridge-send: bridge unreachable',
    );
    return {
      ok: false,
      sentToBridge: false,
      messageId: null,
      error: `bridge unreachable: ${err.message}`,
    };
  }
}
