// IMPORTANT: polyfills MUST be the first import. They patch globalThis
// (e.g. globalThis.WebSocket) BEFORE @supabase/auth-js performs its
// module-level check on Node.js < 22.
import './polyfills';

// IMPORTANT: config is loaded next so .env is parsed before any module
// reads process.env at module-load time.
import './config';

import express from 'express';
import path from 'path';
import cors from 'cors';
import webhookRouter from './routes/webhook';
import demoRouter from './routes/demo';
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import superadminRouter from './routes/superadmin';
import onboardingRouter from './routes/onboarding';
import bridgeRouter from './routes/bridge';
import freeTrialSignupRouter from './routes/free-trial-signup';
import waitlistRouter from './routes/waitlist';
import { logger, childLogger } from './lib/logger';
import { startTrialExpiryJob } from './jobs/trial-expiry';
import { stopAllJobs } from './lib/scheduler';

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

// ---------------------------------------------------------------------------
// CORS — allow the Recepta frontend (and any localhost dev origin) to
// call this API. The frontend sends Authorization: Bearer <jwt>, so we
// must allow that header explicitly (cors's default allow-list covers
// the common Content-Type/Accept but not custom headers).
//
// Permissive in dev (any localhost port); lock down to a single origin
// list once we have a real production URL.
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:5173',
];
app.use(
  cors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no Origin (curl, server-to-server, Postman)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      // Production: also allow any *.recepta.pk if you add one later
      // (kept simple for MVP — easy to harden when needed)
      return cb(null, true); // permissive in dev
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);
app.use(express.json({ limit: '15mb' }));

// Health endpoint — reports transport + per-salon session snapshot.
// Production-grade: external uptime monitors hit this.
app.get('/health', (_req, res) => {
  const body: Record<string, unknown> = {
    status: 'ok',
    service: 'halo-backend',
    transport: TRANSPORT,
    uptime_seconds: Math.round(process.uptime()),
    node_env: process.env.NODE_ENV ?? 'development',
    bridge_url: process.env.BRIDGE_URL ?? null,
  };

  res.json(body);
});

// Static demo chat widget (jury demo / local testing).
app.use('/demo', express.static(path.join(__dirname, '..', 'public')));

// Demo chat route — always mounted, transport-agnostic.
app.use(demoRouter);

// Owner dashboard API — JWT auth + per-business scoping.
// Auth routes (signup helper, /me) mounted at root /api/auth.
app.use('/api', authRouter);
// Dashboard CRUD at /api/business/... and /api/appointments/..., /api/staff/...
app.use('/api', dashboardRouter);
// Superadmin platform endpoints — /api/salons, /api/audit, /api/kpis, etc.
app.use('/api', superadminRouter);
// Service-to-service endpoints for the bridge service (Phase 1). The router
// is token-gated inside routes/bridge.ts; we mount it here so /api/bridge/*
// becomes reachable. Used by bridge/src/bridge-client.ts for active-businesses
// discovery and inbound-message delivery.
app.use('/api', bridgeRouter);
app.use('/api', freeTrialSignupRouter);
// Wave 8 — landing-page waitlist capture. Public POST endpoint, no auth.
app.use('/api', waitlistRouter);
// Onboarding proxy — /onboarding/:id/* is forwarded to the bridge service
// (Phase 1). Mounted at root because the path is part of the URL space shared
// with the bridge's own QR server.
app.use('/', onboardingRouter);

// ---------------------------------------------------------------------------
// Transport-specific setup
//
// Phase 1: the in-process web transport (SessionManager / chromium lifecycle)
// has been moved to the separate bridge service. The backend is now stateless
// w.r.t. WhatsApp-web — it proxies /onboarding/* requests to the bridge and
// only mounts /webhook for the Meta Cloud transport.
// ---------------------------------------------------------------------------

if (TRANSPORT === 'cloud') {
  // Meta Cloud API. /webhook receives messages from Meta; /webhook GET
  // is the verification handshake.
  app.use(webhookRouter);
  log.info('transport: cloud (Meta Cloud API)');
}

if (TRANSPORT === 'web') {
  log.warn(
    { transport: TRANSPORT },
    'WHATSAPP_TRANSPORT=web is now handled by the bridge service; backend is transport-agnostic. Set BRIDGE_URL and start bridge/ instead.'
  );
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  log.info({ port: PORT, transport: TRANSPORT }, 'halo backend listening');

  // Wave 7 (Phase 4) — start the trial-expiry scheduled job. Hourly:
  // (a) WhatsApp-warn owners whose trial ends in 0-2 days, flip to
  //     'expiring_soon'.
  // (b) Flip any trial whose trial_ends_at has passed to 'expired'.
  // The job lives in lib/jobs/trial-expiry.ts; see lib/scheduler.ts for
  // the small registry that ticks it.
  startTrialExpiryJob();
});

// ---------------------------------------------------------------------------
// Graceful shutdown
//
// Sequence:
//   1. Stop accepting new HTTP connections (server.close)
//   2. Exit cleanly
//
// Bounded by SHUTDOWN_TIMEOUT_MS so a stuck request doesn't hold up
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

  // Wave 7 (Phase 4) — stop the trial-expiry job so in-flight ticks
  // don't outlive the process. Safe to call even if no jobs registered.
  stopAllJobs();

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
