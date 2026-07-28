import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { childLogger } from './logger';
import {
  WhatsAppWebClient,
  ClientStatus,
  IncomingMessageEvent,
  StatusChangeEvent,
} from './client';

// ---------------------------------------------------------------------------
// Session manager — owns one WhatsApp-web.js Client per active salon.
//
// Responsibilities:
//   - At startup: load active businesses from Supabase and create a Client
//     per salon, restoring their LocalAuth sessions from disk.
//   - At runtime: register new salons (when added to the DB) and unregister
//     deactivated ones.
//   - Forward client events upward (incoming-message, status-change) so
//     the QR server + health endpoint can subscribe.
//   - Graceful shutdown: destroy all clients cleanly on SIGTERM/SIGINT.
//
// Multi-tenant guarantee: one failure (e.g. one salon's Chromium crashes)
// does NOT take down the others. Each client is independent.
// ---------------------------------------------------------------------------

const log = childLogger('whatsapp-web.session-manager');

interface ClientEventMap {
  'incoming-message': (event: IncomingMessageEvent) => void;
  'status-change': (event: StatusChangeEvent) => void;
}

export declare interface SessionManager {
  on<U extends keyof ClientEventMap>(
    event: U,
    listener: ClientEventMap[U]
  ): this;
  emit<U extends keyof ClientEventMap>(
    event: U,
    ...args: Parameters<ClientEventMap[U]>
  ): boolean;
}

export interface SessionManagerOptions {
  /**
   * Root directory for all salon session directories. One subdirectory
   * per salon will be created under here. Bind-mount this path in Docker
   * so sessions survive container restarts.
   *
   * Example: /app/sessions  →  /app/sessions/<business-id>/...
   */
  sessionsRoot: string;
}

export interface ClientStatusSnapshot {
  status: ClientStatus;
  hasQR: boolean;
}

export class SessionManager extends EventEmitter {
  private readonly sessionsRoot: string;
  private readonly clients: Map<string, WhatsAppWebClient> = new Map();
  private started = false;

  // Serialize chromium initialization across all salons. Without this,
  // when the backend boots with N active businesses it tries to launch
  // N chromium instances in parallel — they end up starving each
  // other of CPU/memory/disk-IO on modest hosts and none of them ever
  // reaches the `qr_pending` state. By chaining initialize() calls
  // through this queue, each chromium gets a clean boot window before
  // the next one starts.
  //
  // Trade-off: with N salons, cold start takes N × ~30s. For the demo
  // and any single-salon setup, this is irrelevant. For multi-tenant
  // production we'd want per-salon readiness instead.
  private initChain: Promise<unknown> = Promise.resolve();
  private activeInits = new Set<string>();

  constructor(options: SessionManagerOptions) {
    super();
    // Resolve to absolute so paths inside client.ts don't depend on
    // process.cwd() (which can drift if the bridge is launched from
    // different working directories).
    this.sessionsRoot = path.resolve(options.sessionsRoot);

    // Ensure root dir exists. We create it lazily so callers don't have
    // to worry about pre-creating directories in Docker.
    if (!fs.existsSync(this.sessionsRoot)) {
      fs.mkdirSync(this.sessionsRoot, { recursive: true });
      log.info({ sessionsRoot: this.sessionsRoot }, 'created sessions root');
    }
  }

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------

  /**
   * Bootstrap the session manager with the list of business ids the main
   * API considers active. The bridge service has no direct database
   * access — the main API is the source of truth for which salons should
   * have a Web session running.
   *
   * Idempotent — calling twice is a no-op.
   *
   * Failures are isolated: if one salon's Client fails to initialize,
   * the others still come up. The failed salon is left in 'expired' state
   * and the operator can re-trigger via /onboarding re-scan.
   *
   * Replaces the original `start()` (which used to query Supabase
   * directly). The list-of-businesses fetch now lives on the main API
   * behind `/api/bridge/active-businesses`.
   */
  async bootstrap(businessIds: string[]): Promise<void> {
    if (this.started) {
      log.warn('bootstrap() called twice; ignoring');
      return;
    }
    this.started = true;

    const list = Array.isArray(businessIds) ? businessIds : [];
    log.info(
      { sessionsRoot: this.sessionsRoot, count: list.length },
      'session manager starting'
    );

    // Register clients sequentially. The actual chromium boot is queued
    // behind `initChain` inside registerClient() — see the initChain
    // field comment. This means with N active businesses, cold start
    // takes roughly N × chromium-boot-time (~30s each). For a single-
    // salon demo that's fine; for multi-tenant production we'd want
    // per-salon readiness checks.
    for (const businessId of list) {
      try {
        await this.registerClient(businessId, { waitForInit: false });
      } catch (e) {
        log.error(
          { businessId, err: (e as Error).message },
          'failed to register client (continuing with others)'
        );
      }
    }

    log.info(
      { activeSessions: this.clients.size },
      'session manager started'
    );
  }

  // -------------------------------------------------------------------------
  // Per-salon registration
  // -------------------------------------------------------------------------

  /**
   * Register a Client for a salon. Used at startup AND when a new salon
   * is added to the businesses table at runtime.
   *
   * If a client for this businessId already exists, the old one is
   * destroyed first (idempotent for retries).
   *
   * @param waitForInit  If true, await initialize() before returning.
   *                     Default false (initialize runs in background)
   *                     so a slow startup doesn't block others.
   */
  async registerClient(
    businessId: string,
    options: { waitForInit?: boolean } = {}
  ): Promise<WhatsAppWebClient> {
    const existing = this.clients.get(businessId);
    if (existing) {
      log.warn(
        { businessId },
        'client already registered; destroying old instance'
      );
      await existing.destroy();
      this.clients.delete(businessId);
    }

    const sessionDir = path.join(this.sessionsRoot, businessId);
    const client = new WhatsAppWebClient({ businessId, sessionDir });

    // Forward child events upward so external listeners (QR server,
    // health endpoint, audit log) can subscribe at the manager level.
    client.on('incoming-message', (event) => {
      this.emit('incoming-message', event);
    });
    client.on('status-change', (event) => {
      this.emit('status-change', event);
    });

    this.clients.set(businessId, client);
    log.info({ businessId, sessionDir }, 'client registered');

    // Serialize initialize() so only one chromium boot is in flight at
    // a time across the whole SessionManager. See `initChain` comment
    // for the rationale.
    this.activeInits.add(businessId);
    const next = this.initChain.then(async () => {
      try {
        await client.initialize();
      } catch (e) {
        log.error(
          { businessId, err: (e as Error).message },
          'initialize failed'
        );
      } finally {
        this.activeInits.delete(businessId);
      }
    });
    // Swallow the rejection so the chain itself never breaks — the
    // catch above already logged it. A poisoned chain would skip every
    // subsequent initialize().
    this.initChain = next.catch(() => undefined);

    if (options.waitForInit) {
      await next;
    }

    return client;
  }

  /**
   * Remove a salon from the manager. Destroys its client cleanly.
   * No-op if the salon isn't registered.
   */
  async unregisterClient(businessId: string): Promise<void> {
    const client = this.clients.get(businessId);
    if (!client) {
      log.debug({ businessId }, 'unregisterClient: not registered; no-op');
      return;
    }

    await client.destroy();
    this.clients.delete(businessId);
    log.info({ businessId }, 'client unregistered');
  }

  // -------------------------------------------------------------------------
  // Read-only accessors
  // -------------------------------------------------------------------------

  getClient(businessId: string): WhatsAppWebClient | undefined {
    return this.clients.get(businessId);
  }

  /**
   * Latest QR string for a salon's onboarding page. null means no QR
   * is pending (either already linked, expired, or not registered).
   */
  getLatestQR(businessId: string): string | null {
    const client = this.clients.get(businessId);
    return client ? client.qr : null;
  }

  /**
   * Snapshot of every salon's current status. Used by the /health
   * endpoint and operator dashboards.
   */
  getStatusSnapshot(): Record<string, ClientStatusSnapshot> {
    const snapshot: Record<string, ClientStatusSnapshot> = {};
    for (const [businessId, client] of this.clients.entries()) {
      snapshot[businessId] = {
        status: client.status,
        hasQR: client.qr !== null,
      };
    }
    return snapshot;
  }

  /**
   * How many clients are currently registered. Used for logging + tests.
   */
  get size(): number {
    return this.clients.size;
  }

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  /**
   * Destroy every client cleanly. Called on SIGTERM/SIGINT so we don't
   * leave orphaned Chromium processes.
   */
  async shutdown(): Promise<void> {
    log.info(
      { count: this.clients.size },
      'session manager shutting down'
    );

    const destroyPromises = Array.from(this.clients.values()).map(
      (client) =>
        client.destroy().catch((e) => {
          log.error(
            { err: (e as Error).message },
            'client destroy error during shutdown'
          );
        })
    );

    await Promise.allSettled(destroyPromises);
    this.clients.clear();
    this.started = false;

    log.info('session manager shut down');
  }
}