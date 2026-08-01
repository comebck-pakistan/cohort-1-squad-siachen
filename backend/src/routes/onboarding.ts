// ---------------------------------------------------------------------------
// Onboarding proxy — Phase 1.
//
// The bridge service on :3100 owns the chromium lifecycle and exposes four
// /onboarding/:businessId/* endpoints (HTML pairing page, status JSON,
// register POST, session DELETE). The frontend never talks to the bridge
// directly; it goes through this proxy at the same URLs it has used since
// the pre-Phase-1 era, so no frontend change was required to migrate.
//
// All four routes forward to BRIDGE_URL with the shared X-Bridge-Token header.
// On bridge outage we return 502 with a small JSON body so the frontend can
// surface a clean error instead of a network timeout.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import axios, { AxiosError, Method } from 'axios';

const router = Router();

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3100';
const BRIDGE_TOKEN = process.env.BRIDGE_INTERNAL_TOKEN || '';

type AxiosMethod = 'get' | 'post' | 'delete';

async function forward(
  req: Request,
  res: Response,
  method: AxiosMethod,
  bridgePath: string
): Promise<void> {
  try {
    const response = await axios({
      method: method as Method,
      url: `${BRIDGE_URL}${bridgePath}`,
      headers: {
        'X-Bridge-Token': BRIDGE_TOKEN,
        ...(method !== 'get' && req.body
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      data: method !== 'get' ? req.body : undefined,
      // Don't throw on non-2xx — pass the bridge's status through verbatim.
      validateStatus: () => true,
      // The pairing page returns HTML; allow non-JSON.
      responseType: 'text',
      transformResponse: [(x) => x],
      timeout: 10_000,
    });

    const ct = String(response.headers['content-type'] || '');
    if (ct.includes('application/json')) {
      res.status(response.status).type('application/json').send(response.data);
    } else {
      res.status(response.status).send(response.data);
    }
  } catch (e) {
    const err = e as AxiosError;
    res.status(502).json({
      error: 'bridge_unavailable',
      detail: err.message,
      bridge_url: BRIDGE_URL,
    });
  }
}

// GET /onboarding/:businessId — HTML pairing page (rendered by the bridge).
router.get('/onboarding/:businessId', (req, res) =>
  forward(req, res, 'get', `/onboarding/${req.params.businessId}`)
);

// GET /onboarding/:businessId/status — JSON { status, qr, hasQR }.
router.get('/onboarding/:businessId/status', (req, res) =>
  forward(req, res, 'get', `/onboarding/${req.params.businessId}/status`)
);

// POST /onboarding/:businessId/register — start a new QR session.
router.post('/onboarding/:businessId/register', (req, res) =>
  forward(req, res, 'post', `/onboarding/${req.params.businessId}/register`)
);

// DELETE /onboarding/:businessId/session — tear down the chromium session.
router.delete('/onboarding/:businessId/session', (req, res) =>
  forward(req, res, 'delete', `/onboarding/${req.params.businessId}/session`)
);

export default router;
