import './polyfills';
import './config';

import path from 'path';
import express from 'express';
import cors from 'cors';
import { logger, childLogger } from './logger';
import { SessionManager } from './session-manager';
import { createOnboardingRouter } from './qr-server';
import { fetchActiveBusinesses } from './bridge-client';

// ---------------------------------------------------------------------------
// Recepta Bridge — entry point.
//
// This service owns the WhatsApp Web QR-pair transport. It runs the chromiums,
// the LocalAuth directories, and the four `/onboarding/:id/*` endpoints the
// salon's onboarding UI polls. It is intentionally separate from the core API
// so that:
//
//   - the core API has no chromium dependency, no process-group-leak risk
//   - this service can be restarted, scaled horizontally, and (in Phase 2)
//     swap to a single-chromium-multi-context model without touching the
//     core API or the frontend
//   - Meta Cloud transport keeps working even if this service is down
//
// Bridge ↔ Core API contract is two endpoints on the core API:
//   - GET  /api/bridge/active-businesses   (boot-time population)
//   - POST /api/bridge/inbound             (every WhatsApp message → reply)
//
// Both require X-Bridge-Token header.
// ---------------------------------------------------------------------------

const log = childLogger('bridge');

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 3100;
const SESSIONS_ROOT =
  process.env.WHATSAPP_SESSIONS_ROOT ||
  path.resolve(process.cwd(), 'sessions');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

if (!process.env.BRIDGE_INTERNAL_TOKEN) {
  log.warn(
    'BRIDGE_INTERNAL_TOKEN is not set; /api/bridge/* on the core API will reject every request from this bridge.'
  );
}

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);
app.use(express.json());

// One session manager per bridge process. Owns every salon's
// WhatsAppWebClient — and therefore every salon chromium.
const sessionManager = new SessionManager({ sessionsRoot: SESSIONS_ROOT });

// Mount the four /onboarding/:id/* endpoints. Identical public surface to
// before the move; only the host changed. Core API now proxies the same URLs
// at /onboarding/* back into this router.
app.use(createOnboardingRouter(sessionManager));

// Internal health endpoint. Returns bridge liveness + per-salon status
// snapshot (handy for ops debugging without having to also hit the core API).
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'recepta-bridge',
    uptime_seconds: Math.round(process.uptime()),
    node_env: process.env.NODE_ENV ?? 'development',
    backend_url: BACKEND_URL,
    sessions: sessionManager.getStatusSnapshot(),
    session_count: sessionManager.size,
  });
});

const server = app.listen(BRIDGE_PORT, () => {
  log.info({ port: BRIDGE_PORT, backend: BACKEND_URL }, 'bridge listening');

  // Fetch the active-businesses list from the core API once at boot, then
  // register a WhatsAppWebClient per business via sessionManager.bootstrap.
  // This replaces the old direct-Supabase read in SessionManager.start().
  fetchActiveBusinesses()
    .then((ids) => {
      log.info({ count: ids.length }, 'active-businesses fetched from core API');
      return sessionManager.bootstrap(ids);
    })
    .then(() => {
      log.info(
        { activeSessions: sessionManager.size },
        'session manager started'
      );
    })
    .catch((e) => {
      log.fatal(
        { err: (e as Error).message },
        'session manager failed to bootstrap; exiting'
      );
      process.exit(1);
    });
});

// ---------------------------------------------------------------------------
// Graceful shutdown — destroy every chromium before exit.
//
// This is the only path that cleans up the chromiums the bridge owns. SIGINT
// (Ctrl-C) and SIGTERM (orchestrator stop) both route here. uncaughtException
// also flushes clients before exiting so orphan chromiums never escape.
// ---------------------------------------------------------------------------

const SHUTDOWN_TIMEOUT_MS = 25_000;
let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const forceTimer = setTimeout(() => {
    log.error(
      { timeoutMs: SHUTDOWN_TIMEOUT_MS },
      'shutdown timed out; forcing exit'
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  await new Promise<void>((resolve) => {
    server.close(() => {
      log.info('http server closed');
      resolve();
    });
  });

  try {
    await sessionManager.shutdown();
  } catch (e) {
    log.error(
      { err: (e as Error).message },
      'session manager shutdown error (continuing)'
    );
  }

  clearTimeout(forceTimer);
  log.info({ signal }, 'shutdown complete');
  process.exit(exitCode);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason: String(reason) }, 'unhandled rejection');
});
process.on('uncaughtException', (err) => {
  log.error({ err: err.message, stack: err.stack }, 'uncaught exception');
  void shutdown('uncaughtException', 1);
});
