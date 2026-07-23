// IMPORTANT: polyfills MUST be the first import. They patch globalThis
// (e.g. globalThis.WebSocket) BEFORE @supabase/auth-js performs its
// module-level check on Node.js < 22.
import './polyfills';

// IMPORTANT: config is loaded next so .env is parsed before any module
// reads process.env at module-load time.
import './config';

import express from 'express';
import path from 'path';
import webhookRouter from './routes/webhook';
import demoRouter from './routes/demo';
import { logger, childLogger } from './lib/logger';
import { SessionManager } from './whatsapp-web/session-manager';
import { createOnboardingRouter } from './whatsapp-web/qr-server';

// ---------------------------------------------------------------------------
// Halo backend entry point.
//
// Transports (selected by WHATSAPP_TRANSPORT env var):
//   "cloud" — Meta Cloud API. /webhook receives messages from Meta.
//   "web"   — whatsapp-web.js. Each salon opens a headless Chromium
//             linked to their WhatsApp via QR scan. Messages flow via
//             library events, not HTTP.
//
// Both transports call into the same lib/message-handler.ts for the
// business logic (customer lookup, state, LLM reply).
//
// Demo route (POST /demo/chat) is always mounted — it bypasses both
// transports and is used for the jury demo + local testing.
// ---------------------------------------------------------------------------

const log = childLogger('index');

// ---------------------------------------------------------------------------
// Env validation — fail fast on bad config
// ---------------------------------------------------------------------------

const TRANSPORT = process.env.WHATSAPP_TRANSPORT || 'cloud';
if (TRANSPORT !== 'cloud' && TRANSPORT !== 'web') {
  log.fatal(
    { transport: TRANSPORT },
    'WHATSAPP_TRANSPORT must be "cloud" or "web"'
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const SESSIONS_ROOT =
  process.env.WHATSAPP_SESSIONS_ROOT ||
  path.resolve(process.cwd(), 'sessions');

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Health endpoint — reports transport + per-salon session snapshot.
// Production-grade: external uptime monitors hit this.
app.get('/health', (_req, res) => {
  const body: Record<string, unknown> = {
    status: 'ok',
    service: 'halo-backend',
    transport: TRANSPORT,
    uptime_seconds: Math.round(process.uptime()),
    node_env: process.env.NODE_ENV ?? 'development',
  };

  if (sessionManager) {
    body.sessions = sessionManager.getStatusSnapshot();
    body.session_count = sessionManager.size;
  }

  res.json(body);
});

// Static demo chat widget (jury demo / local testing).
app.use('/demo', express.static(path.join(__dirname, '..', 'public')));

// Demo chat route — always mounted, transport-agnostic.
app.use(demoRouter);

// ---------------------------------------------------------------------------
// Transport-specific setup
// ---------------------------------------------------------------------------

let sessionManager: SessionManager | null = null;

if (TRANSPORT === 'cloud') {
  // Meta Cloud API. /webhook receives messages from Meta; /webhook GET
  // is the verification handshake.
  app.use(webhookRouter);
  log.info('transport: cloud (Meta Cloud API)');
}

if (TRANSPORT === 'web') {
  // whatsapp-web.js. Each salon opens a Chromium session linked via QR.
  // Messages flow through library events, NOT HTTP — so no /webhook
  // route is mounted. QR + status endpoints ARE mounted so salon owners
  // can complete onboarding in their browser.
  sessionManager = new SessionManager({ sessionsRoot: SESSIONS_ROOT });
  app.use(createOnboardingRouter(sessionManager));
  log.info(
    { sessionsRoot: SESSIONS_ROOT },
    'transport: web (whatsapp-web.js)'
  );
}

// ---------------------------------------------------------------------------
// HTTP server + session manager startup
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  log.info({ port: PORT, transport: TRANSPORT }, 'halo backend listening');

  if (sessionManager) {
    // Start the session manager AFTER the HTTP server is listening,
    // because the QR server is already accepting requests at this point.
    sessionManager.start().catch((e) => {
      log.fatal(
        { err: (e as Error).message },
        'session manager failed to start; exiting'
      );
      process.exit(1);
    });
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown
//
// Sequence:
//   1. Stop accepting new HTTP connections (server.close)
//   2. Tear down every whatsapp-web.js Client (closes Chromium)
//   3. Exit cleanly
//
// Bounded by SHUTDOWN_TIMEOUT_MS so a stuck Chromium doesn't hold up
// container orchestration (Docker gives ~30s before SIGKILL).
// ---------------------------------------------------------------------------

const SHUTDOWN_TIMEOUT_MS = 25_000;
let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ signal }, 'shutdown initiated');

  // Force-exit safety net. If cleanup hangs (stuck Chromium, etc.),
  // we still terminate so the orchestrator doesn't have to SIGKILL us.
  const forceTimer = setTimeout(() => {
    log.error(
      { timeoutMs: SHUTDOWN_TIMEOUT_MS },
      'shutdown timed out; forcing exit'
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  // Stop accepting new connections. Existing requests still finish.
  await new Promise<void>((resolve) => {
    server.close(() => {
      log.info('http server closed');
      resolve();
    });
  });

  if (sessionManager) {
    try {
      await sessionManager.shutdown();
    } catch (e) {
      log.error(
        { err: (e as Error).message },
        'session manager shutdown error (continuing)'
      );
    }
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
  log.error(
    { reason: reason instanceof Error ? reason.message : String(reason) },
    'unhandled promise rejection'
  );
});

process.on('uncaughtException', (err) => {
  log.fatal(
    { err: err.message, stack: err.stack },
    'uncaught exception; shutting down'
  );
  void shutdown('uncaughtException', 1);
});

// Loud banner so the first thing in the log is unambiguous.
logger.info(
  { transport: TRANSPORT, port: PORT, pid: process.pid },
  'halo-backend starting'
);