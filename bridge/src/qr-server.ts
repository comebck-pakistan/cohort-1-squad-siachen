import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import { SessionManager } from './session-manager';
import { childLogger } from './logger';

// ---------------------------------------------------------------------------
// QR onboarding endpoints.
//
// Public URLs (no auth) — TODO for production: add a per-salon onboarding
// token so only the salon owner can scan. For now this is acceptable
// because businessId is a UUID (unguessable) and the only thing exposed
// is the salon's own QR code.
//
//   GET    /onboarding/:businessId              — HTML page with auto-refreshing QR
//   GET    /onboarding/:businessId/status       — JSON: {businessId, status, hasQR, qr}
//   POST   /onboarding/:businessId/register     — register a new salon with the
//                                                  SessionManager so a Chromium
//                                                  session starts and a QR is generated
//   POST   /onboarding/:businessId/send         — owner-driven outbound send
//                                                  (proxied from
//                                                  /api/conversations/:id/owner-reply).
//                                                  Requires X-Bridge-Token.
//   DELETE /onboarding/:businessId/session      — disconnect + destroy session
//
// The HTML page polls itself every 5–30s so the salon owner sees the QR
// update and the success page without manual refresh.
//
// The JSON status endpoint now returns `qr` (raw QR string) so the
// salon-portal's modal can render the QR as a real image (not a placeholder
// icon) via qrcode.react.
// ---------------------------------------------------------------------------

const log = childLogger('whatsapp-web.qr-server');

export function createOnboardingRouter(manager: SessionManager): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // HTML onboarding page
  // -------------------------------------------------------------------------
  router.get('/onboarding/:businessId', async (req: Request, res: Response) => {
    const { businessId } = req.params;
    log.info({ businessId }, 'onboarding page requested');

    const client = manager.getClient(businessId);

    if (!client) {
      return res
        .status(404)
        .type('html')
        .send(htmlError(`Salon ${businessId} is not registered with Halo.`));
    }

    // Already linked — show success page (no auto-refresh needed)
    if (client.status === 'ready') {
      return res.type('html').send(htmlReady(businessId));
    }

    // QR available — show it
    const qr = client.qr;
    if (qr) {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
        return res.type('html').send(htmlWithQR(dataUrl, client.status));
      } catch (e) {
        log.error(
          { businessId, err: (e as Error).message },
          'QR rendering failed'
        );
        return res
          .status(500)
          .type('html')
          .send(htmlError('Failed to render QR code. Please try again.'));
      }
    }

    // No QR yet — show waiting page (auto-refresh every 5s)
    return res.type('html').send(htmlWaiting(client.status));
  });

  // -------------------------------------------------------------------------
  // Status JSON — for the operator dashboard / modal polling
  //
  // Returns the raw QR text (if available) so the frontend can render it
  // as an SVG/canvas via qrcode.react. The text is the same string
  // whatsapp-web.js uses internally; it's not a signed URL.
  // -------------------------------------------------------------------------
  router.get(
    '/onboarding/:businessId/status',
    (req: Request, res: Response) => {
      const { businessId } = req.params;
      const client = manager.getClient(businessId);

      if (!client) {
        return res.status(404).json({
          businessId,
          status: 'not_found' as const,
          hasQR: false,
          qr: null,
          pairing_method: null,
          pairing_code: null,
        });
      }

      return res.json({
        businessId,
        status: client.status,
        hasQR: client.qr !== null,
        qr: client.qr, // raw QR text — frontend renders via qrcode.react
        // Phone-pairing fields. Both populated only when the salon
        // owner invoked POST /pair-with-phone; default is null and
        // method='qr'. The frontend uses these to render either the
        // QR or the XXXX-XXXX code.
        pairing_method: client.method,
        pairing_code: client.pairingCode, // raw "ABCDEFGH" — modal formats
        updated_at: new Date().toISOString(),
      });
    }
  );

  // -------------------------------------------------------------------------
  // POST /onboarding/:businessId/register
  //
  // Idempotent — if a client already exists it returns its status (so the
  // frontend can show "still pairing, please wait"). Otherwise registers
  // a new WhatsApp-web.js client, kicks off initialization in the
  // background, and returns immediately.
  //
  // Auth note: this is currently unauthenticated because the salon owner
  // is the one calling it from /salon-portal/onboarding. UUIDs are
  // unguessable so the attack surface is small. v2 should require the
  // owner's Supabase JWT.
  // -------------------------------------------------------------------------
  router.post(
    '/onboarding/:businessId/register',
    async (req: Request, res: Response) => {
      const { businessId } = req.params;
      const existing = manager.getClient(businessId);

      // Restartable states — an existing client in a healthy state
      // means pairing is already in progress or already complete. We
      // short-circuit so we don't kill a working session.
      //
      // Terminal states (expired / destroyed) mean the previous session
      // is dead — the QR won't come back. We fall through and force a
      // re-register so the owner can recover without restarting the
      // backend.
      const isHealthy =
        existing &&
        (existing.status === 'initializing' ||
          existing.status === 'qr_pending' ||
          existing.status === 'authenticated' ||
          existing.status === 'ready' ||
          existing.status === 'disconnected'); // disconnected → will auto-reconnect

      if (isHealthy) {
        log.info(
          { businessId, status: existing!.status },
          'register called on healthy client; no-op'
        );
        return res.json({
          businessId,
          already_registered: true,
          status: existing!.status,
          hasQR: existing!.qr !== null,
        });
      }

      // Either no client, or a terminal one — force a re-register.
      if (existing) {
        log.info(
          { businessId, status: existing.status },
          'register called on terminal client; replacing'
        );
        await manager.unregisterClient(businessId);
      }

      try {
        // Runs in background — don't await initialization. The QR appears
        // within 1-5 seconds as the Chromium instance boots.
        await manager.registerClient(businessId, { waitForInit: false });
        log.info(
          { businessId },
          'registered new WhatsApp client; QR generation started'
        );
        return res.status(202).json({
          businessId,
          already_registered: false,
          status: 'initializing' as const,
          hasQR: false,
          message:
            'Session registration started. QR appears within 5-30 seconds.',
        });
      } catch (e) {
        log.error(
          { businessId, err: (e as Error).message },
          'register client failed'
        );
        return res.status(500).json({
          error: `Failed to register session: ${(e as Error).message}`,
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /onboarding/:businessId/pair-with-phone
  //
  // Triggers the phone-pairing handshake for an already-registered
  // client. Body: { phoneNumber: string } in raw digits (E.164, no '+').
  //
  // Idempotent only in the sense that calling it twice returns a fresh
  // code (the library rotates every intervalMs internally). It does NOT
  // switch the client back to QR mode — once you've picked phone, you
  // stay on phone until you destroy the session and re-register.
  //
  // Errors:
  //   400 — invalid phoneNumber (empty, wrong format)
  //   404 — no client registered for this business (must /register first
  //         OR the previous session was destroyed)
  //   409 — client exists but isn't initialized yet (chromium still
  //         booting; caller should poll status until status changes
  //         off 'initializing')
  //   500 — library error from the underlying puppeteer page
  // -------------------------------------------------------------------------
  router.post(
    '/onboarding/:businessId/pair-with-phone',
    async (req: Request, res: Response) => {
      const { businessId } = req.params;
      const { phoneNumber } = (req.body || {}) as { phoneNumber?: string };

      if (!phoneNumber || typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
        return res.status(400).json({
          error: 'missing or empty `phoneNumber`',
        });
      }

      // Existence check first so we can give a clean 404 before the
      // library call. The underlying client.requestPhonePairing()
      // throws "no client" as a generic Error — surfacing as 404 here
      // keeps the contract tidy.
      const client = manager.getClient(businessId);
      if (!client) {
        return res.status(404).json({
          error: 'No active session for this business. Call /register first.',
        });
      }

      // Initialize-check: the public library API only works after
      // chromium has reached the UNPAIRED state, which initialize()
      // drives. If the client is still in 'initializing', the library
      // would throw a generic puppeteer error — give a clean 409
      // instead so the frontend can poll and retry.
      if (client.status === 'initializing') {
        return res.status(409).json({
          error: 'session still initializing; poll /status and retry once status leaves initializing',
          current_status: client.status,
        });
      }

      try {
        const code = await manager.requestPhonePairing(
          businessId,
          phoneNumber.trim()
        );
        log.info(
          { businessId, codeLength: code.length },
          'phone pairing code generated'
        );
        return res.json({
          businessId,
          pairing_method: 'phone' as const,
          // Raw "ABCDEFGH" — frontend formats as XXXX-XXXX for display.
          pairing_code: code,
          status: 'code_pending' as const,
        });
      } catch (e) {
        const message = (e as Error).message;
        log.error(
          { businessId, err: message },
          'phone pairing failed'
        );
        // Library-side "Invalid phone" / "Evaluation failed" /
        // "PairingCodeLinkUtils timeout" all surface here. Let the
        // frontend render the message — operator can decide whether
        // to retry.
        if (
          message.includes('Invalid phone') ||
          message.includes('8-15 digits')
        ) {
          return res.status(400).json({ error: message });
        }
        return res.status(500).json({ error: message });
      }
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /onboarding/:businessId/session
  //
  // Disconnects the salon — useful when the owner wants to unpair their
  // phone (e.g. lost device, switching staff). Logs out from WhatsApp's
  // servers, then closes the underlying Chromium session.
  // -------------------------------------------------------------------------
  router.delete(
    '/onboarding/:businessId/session',
    async (req: Request, res: Response) => {
      const { businessId } = req.params;
      const client = manager.getClient(businessId);
      if (!client) {
        return res
          .status(404)
          .json({ error: 'No active session for this business' });
      }
      try {
        await manager.logoutClient(businessId);
        return res.json({ disconnected: true, businessId });
      } catch (e) {
        log.error(
          { businessId, err: (e as Error).message },
          'disconnect failed'
        );
        return res
          .status(500)
          .json({ error: `Failed to disconnect: ${(e as Error).message}` });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /onboarding/:businessId/send
  //
  // Owner-driven outbound send. The salon portal's "Take Over Chat" +
  // textarea → Send button hits the backend's
  // /api/conversations/:id/owner-reply endpoint, which then proxies
  // here. The bridge is the only place that owns the live
  // WhatsAppWebClient instance, so this is where the actual `sendMessage`
  // call has to land.
  //
  // Auth: the calling backend (and only the backend) sets
  // `X-Bridge-Token: <shared secret>`. We require it here as defense
  // in depth — a hostile party who guesses the business UUID cannot
  // drive sends without the token. Mirrors the backend's
  // requireBridgeToken pattern in routes/bridge.ts.
  //
  // Body: { to: string, text: string }
  //   to   — the customer's chat id in @c.us or LID format (whatever
  //          whatsapp-web.js expects for client.sendMessage). The
  //          backend is responsible for resolving the normalized
  //          phone back to the right format before calling.
  //   text — the reply text. Trimmed; refused if empty.
  //
  // Returns: { ok: true, to } on success.
  //          401 invalid/missing X-Bridge-Token
  //          400 missing/empty body fields
  //          404 no active client for this business (session lost or
  //               never paired)
  //          500 sendTextMessage threw — logs and surfaces the error
  //               so the backend can decide whether to mark the
  //               owner_message as failed in the messages table.
  // -------------------------------------------------------------------------
  router.post(
    '/onboarding/:businessId/send',
    async (req: Request, res: Response) => {
      const expected = process.env.BRIDGE_INTERNAL_TOKEN;
      if (!expected) {
        log.warn('BRIDGE_INTERNAL_TOKEN not configured; refusing outbound send');
        return res
          .status(503)
          .json({ error: 'bridge send service not configured' });
      }
      if (req.header('x-bridge-token') !== expected) {
        return res
          .status(401)
          .json({ error: 'invalid or missing X-Bridge-Token' });
      }

      const { businessId } = req.params;
      const { to, text } = (req.body || {}) as {
        to?: string;
        text?: string;
      };

      if (!to || typeof to !== 'string' || !to.trim()) {
        return res.status(400).json({ error: 'missing or empty `to`' });
      }
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'missing or empty `text`' });
      }

      const client = manager.getClient(businessId);
      if (!client) {
        return res
          .status(404)
          .json({ error: 'No active WhatsApp session for this business' });
      }

      try {
        await client.sendTextMessage(to.trim(), text.trim());
        log.info(
          { businessId, to, textLength: text.trim().length },
          'outbound owner-send dispatched'
        );
        return res.json({ ok: true, to: to.trim() });
      } catch (e) {
        log.error(
          { businessId, err: (e as Error).message },
          'outbound owner-send failed'
        );
        return res
          .status(500)
          .json({ error: `send failed: ${(e as Error).message}` });
      }
    }
  );

  return router;
}

// ---------------------------------------------------------------------------
// HTML templates — kept inline because they're small and tightly coupled
// to this route. Extracting them would be premature.
// ---------------------------------------------------------------------------

function htmlWithQR(qrDataURL: string, status: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Halo — Link WhatsApp</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 20px; text-align: center; color: #111827; background: #f9fafb; }
    h1 { color: #0d9488; margin-bottom: 8px; }
    .subtitle { color: #6b7280; margin-top: 0; }
    .status { display: inline-block; padding: 6px 14px; background: #fef3c7; color: #92400e; border-radius: 999px; font-size: 13px; margin-bottom: 24px; font-family: ui-monospace, monospace; }
    .qr-container { margin: 24px auto; padding: 24px; background: white; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); display: inline-block; }
    .qr-container img { display: block; }
    ol { text-align: left; max-width: 400px; margin: 28px auto; line-height: 1.9; padding-left: 24px; }
    ol li { margin-bottom: 6px; }
    .refresh-note { color: #6b7280; font-size: 13px; margin-top: 28px; }
  </style>
</head>
<body>
  <h1>Link your WhatsApp</h1>
  <p class="subtitle">Scan the QR code with your phone to connect your salon's WhatsApp to Halo.</p>
  <div class="status">status: ${escapeHtml(status)}</div>
  <div class="qr-container">
    <img src="${qrDataURL}" alt="WhatsApp QR Code" width="320" height="320">
  </div>
  <ol>
    <li>Open <strong>WhatsApp</strong> on your phone</li>
    <li>Tap <strong>Settings</strong> → <strong>Linked Devices</strong></li>
    <li>Tap <strong>Link a Device</strong></li>
    <li>Point your phone camera at the QR code above</li>
  </ol>
  <p class="refresh-note">This page refreshes every 30 seconds. Keep it open until you see "Linked".</p>
  <script>setTimeout(() => location.reload(), 30000);</script>
</body>
</html>`;
}

function htmlWaiting(status: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Halo — Link WhatsApp</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 20px; text-align: center; color: #111827; background: #f9fafb; }
    h1 { color: #0d9488; }
    .spinner { font-size: 56px; margin: 32px 0; }
    .status { display: inline-block; padding: 6px 14px; background: #fef3c7; color: #92400e; border-radius: 999px; font-size: 13px; font-family: ui-monospace, monospace; }
    p { color: #6b7280; }
  </style>
</head>
<body>
  <h1>Preparing your QR code…</h1>
  <div class="spinner">⏳</div>
  <div class="status">status: ${escapeHtml(status)}</div>
  <p>This usually takes a few seconds.</p>
  <script>setTimeout(() => location.reload(), 5000);</script>
</body>
</html>`;
}

function htmlReady(businessId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Halo — Linked</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 20px; text-align: center; color: #111827; background: #f9fafb; }
    h1 { color: #16a34a; }
    .checkmark { font-size: 80px; margin: 32px 0; }
    p { color: #4b5563; line-height: 1.6; }
    .biz { font-family: ui-monospace, monospace; background: #f3f4f6; padding: 4px 10px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="checkmark">✅</div>
  <h1>WhatsApp linked successfully!</h1>
  <p>Your salon's WhatsApp is now connected to Halo.</p>
  <p>Customers who message your WhatsApp number will get an instant AI reply. You can close this page.</p>
  <p class="biz">${escapeHtml(businessId)}</p>
</body>
</html>`;
}

function htmlError(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Halo — Error</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 20px; text-align: center; color: #111827; background: #f9fafb; }
    h1 { color: #dc2626; }
    p { color: #4b5563; }
  </style>
</head>
<body>
  <h1>Something went wrong</h1>
  <p>${escapeHtml(message)}</p>
  <p>Contact your Halo administrator if this persists.</p>
</body>
</html>`;
}

/**
 * Minimal HTML escape for the few user-supplied values we interpolate
 * (status strings, businessId). Defends against XSS in the onboarding
 * page. Production-grade: never trust server-generated strings either.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
