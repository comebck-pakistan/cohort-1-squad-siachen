import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { handleIncomingMessage } from '../lib/message-handler';
import { childLogger } from '../lib/logger';

// ---------------------------------------------------------------------------
// /api/bridge/* endpoints — the seam between core API and the QR-pair
// transport (Bridge service).
//
// The Bridge service runs in its own process so it can own chromium
// lifecycle without leaking into the core API. These two endpoints are the
// only contracts the bridge needs to talk to the core API:
//
//   GET  /api/bridge/active-businesses
//        Returns the list of business ids whose `agent_active = true`.
//        Called once by the bridge on boot to populate its session manager.
//
//   POST /api/bridge/inbound
//        Hands one WhatsApp message (already-decoded text + from phone
//        + businessId + messageId) to the same transport-agnostic
//        handleIncomingMessage() the Meta Cloud webhook handler uses. The
//        reply text comes back in the HTTP response so the bridge can send
//        it over WhatsApp.
//
// All requests must include `X-Bridge-Token: <BRIDGE_INTERNAL_TOKEN>`.
// The token is configured identically in both services' .env files. Reject
// everything else with 401 so we never accidentally expose these to the
// open internet.
// ---------------------------------------------------------------------------

const log = childLogger('route.bridge');

const router = Router();

function requireBridgeToken(req: Request, res: Response): boolean {
  const expected = process.env.BRIDGE_INTERNAL_TOKEN;
  if (!expected) {
    // Defense in depth: if the secret isn't configured, refuse to serve.
    // Misconfigured service is worse than down.
    log.warn('BRIDGE_INTERNAL_TOKEN not configured; refusing all bridge traffic');
    res.status(503).json({ error: 'bridge service not configured' });
    return false;
  }
  const provided = req.header('x-bridge-token');
  if (provided !== expected) {
    res.status(401).json({ error: 'invalid or missing X-Bridge-Token' });
    return false;
  }
  return true;
}

router.get('/bridge/active-businesses', async (req, res) => {
  if (!requireBridgeToken(req, res)) return;

  // Wave 7 hardening (Option 1) — don't hand the bridge a session for an
  // expired salon. The bridge trusts this list to bootstrap WhatsAppWebClient
  // instances; if we returned an expired salon's id, the bridge would
  // (a) restore its LocalAuth from disk, (b) re-authenticate against the
  // WhatsApp account, and (c) start firing message events for messages that
  // should be going to the trial-ended fallback path in the core API.
  //
  // This is the boot-time half of the fix. The live-time half lives in
  // jobs/trial-expiry.ts — when the cron flips a salon's status to
  // 'expired', it also calls DELETE /onboarding/:id/session on the bridge
  // to tear down any session that's already alive. Together they close the
  // gap that allowed duplicate bot replies during Wave 7 testing.
  //
  // `converted` is in the IN list — paid customers must keep their bot.
  // Pre-Wave-7 rows have trial_status='active' (migration 17 default),
  // so they pass through unchanged.
  const { data, error } = await getSupabase()
    .from('businesses')
    .select('id')
    .eq('agent_active', true)
    .in('trial_status', ['active', 'expiring_soon', 'converted']);

  if (error) {
    log.error({ err: error.message }, 'failed to load active businesses');
    return res.status(500).json({ error: error.message });
  }

  const businessIds = (data ?? []).map((b) => b.id as string);
  return res.json({ businessIds });
});

router.post('/bridge/inbound', async (req, res) => {
  if (!requireBridgeToken(req, res)) return;

  const { businessId, from, text, messageId } = (req.body || {}) as {
    businessId?: string;
    from?: string;
    text?: string;
    messageId?: string;
  };

  if (!businessId || !from || typeof text !== 'string') {
    return res.status(400).json({
      error: 'missing required fields: businessId, from, text',
    });
  }

  try {
    // Reuse the same transport-agnostic entrypoint the Meta Cloud webhook
    // uses — same persistence, same LLM, same booking. Reply comes back
    // unchanged whether the inbound path is web or cloud.
    const result = await handleIncomingMessage({ businessId, from, text });
    return res.json({ reply: result.reply });
  } catch (e) {
    log.error(
      { businessId, err: (e as Error).message },
      'handleIncomingMessage threw'
    );
    return res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
