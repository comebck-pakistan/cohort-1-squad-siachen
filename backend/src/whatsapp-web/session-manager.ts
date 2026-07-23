import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getSupabase } from '../lib/supabase';
import { childLogger } from '../lib/logger';
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

  constructor(options: SessionManagerOptions) {
    super();
    this.sessionsRoot = options.sessionsRoot;

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
   * Load active businesses from Supabase and register a Client for each.
   * Idempotent — calling twice is a no-op.
   *
   * Failures are isolated: if one salon's Client fails to initialize,
   * the others still come up. The failed salon is left in 'expired' state
   * and the operator can re-trigger via /onboarding re-scan.
   */
  async start(): Promise<void> {
    if (this.started) {
      log.warn('start() called twice; ignoring');
      return;
    }
    this.started = true;

    log.info(
      { sessionsRoot: this.sessionsRoot },
      'session manager starting'
    );

    const { data: businesses, error } = await getSupabase()
      .from('businesses')
      .select('id, name')
      .eq('agent_active', true);

    if (error) {
      log.error(
        { err: error.message },
        'failed to load businesses; session manager not started'
      );
      this.started = false;
      throw new Error(`session-manager start failed: ${error.message}`);
    }

    const list = businesses ?? [];
    log.info(
      { count: list.length },
      'loaded active businesses; registering clients'
    );

    // Sequential is fine — clients initialize in the background and the
    // UI doesn't depend on them being ready immediately. We don't want to
    // start 20 Chromium instances in parallel either.
    for (const biz of list) {
      try {
        await this.registerClient(biz.id, { waitForInit: false });
      } catch (e) {
        log.error(
          { businessId: biz.id, err: (e as Error).message },
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

    if (options.waitForInit) {
      await client.initialize();
    } else {
      // Fire-and-forget. The client logs its own status transitions.
      client.initialize().catch((e) => {
        log.error(
          { businessId, err: (e as Error).message },
          'initialize failed'
        );
      });
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