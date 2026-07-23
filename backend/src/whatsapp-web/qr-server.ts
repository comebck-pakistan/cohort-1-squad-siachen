import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import { SessionManager } from './session-manager';
import { childLogger } from '../lib/logger';

// ---------------------------------------------------------------------------
// QR onboarding endpoints.
//
// Public URLs (no auth) — TODO for production: add a per-salon onboarding
// token so only the salon owner can scan. For now this is acceptable
// because businessId is a UUID (unguessable) and the only thing exposed
// is the salon's own QR code.
//
//   GET /onboarding/:businessId           — HTML page with auto-refreshing QR
//   GET /onboarding/:businessId/status    — machine-readable JSON status
//
// The HTML page polls itself every 5–30s so the salon owner sees the QR
// update and the success page without manual refresh.
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
  // Status JSON — for the operator dashboard / monitoring
  // -------------------------------------------------------------------------
  router.get(
    '/onboarding/:businessId/status',
    (req: Request, res: Response) => {
      const { businessId } = req.params;
      const client = manager.getClient(businessId);

      if (!client) {
        return res.status(404).json({
          businessId,
          status: 'not_found',
          hasQR: false,
        });
      }

      return res.json({
        businessId,
        status: client.status,
        hasQR: client.qr !== null,
      });
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