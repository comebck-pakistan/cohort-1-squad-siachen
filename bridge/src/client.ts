import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { childLogger } from './logger';
import { clearChromiumLocks, clearChromiumLocksWithRetry } from './clear-locks';
import { deliverInboundMessage } from './bridge-client';

// ---------------------------------------------------------------------------
// WhatsApp-web.js client wrapper.
//
// One instance per salon. Owns:
//   - the whatsapp-web.js Client (Puppeteer-controlled Chromium)
//   - LocalAuth session persistence (dataPath per salon)
//   - status state machine (initializing → qr_pending → authenticated → ready)
//   - reconnection logic on disconnect
//   - QR holder for the onboarding page to poll
//
// Emits:
//   - 'incoming-message' — for each text message from a customer
//   - 'status-change'    — for each status transition
//
// Both transports (this and Meta Cloud API) call into the same
// handleIncomingMessage() function in lib/message-handler.ts. The transport
// layer's only job is to get the message IN and send the reply OUT.
// ---------------------------------------------------------------------------

const log = childLogger('whatsapp-web.client');

/**
 * High-level lifecycle state of a salon session.
 *
 * Transitions (typical happy path):
 *   initializing → qr_pending → authenticated → ready
 *                                          ↓
 *                                   disconnected (auto-reconnect)
 *                                          ↓
 *                                   expired (after MAX_RECONNECT_ATTEMPTS)
 *
 * Any state can transition to: destroyed (on graceful shutdown).
 */
export type ClientStatus =
  | 'initializing'
  | 'qr_pending'
  | 'authenticated'
  | 'ready'
  | 'disconnected'
  | 'expired'
  | 'destroyed';

export interface IncomingMessageEvent {
  businessId: string;
  /** Customer phone in whatever form whatsapp-web.js gave us (e.g. "923...@c.us"). */
  from: string;
  text: string;
  /** whatsapp-web.js message id — useful for dedupe and audit. */
  messageId: string;
}

export interface StatusChangeEvent {
  businessId: string;
  status: ClientStatus;
}

interface ClientEventMap {
  'incoming-message': (event: IncomingMessageEvent) => void;
  'status-change': (event: StatusChangeEvent) => void;
}

export declare interface WhatsAppWebClient {
  on<U extends keyof ClientEventMap>(event: U, listener: ClientEventMap[U]): this;
  emit<U extends keyof ClientEventMap>(
    event: U,
    ...args: Parameters<ClientEventMap[U]>
  ): boolean;
}

export interface WhatsAppWebClientOptions {
  /** Salon id from the businesses table. Used as session key + log field. */
  businessId: string;
  /** Directory on disk where LocalAuth stores this salon's session. */
  sessionDir: string;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
const PROFILE_RELEASE_DELAY_MS = 300;

export class WhatsAppWebClient extends EventEmitter {
  private readonly businessId: string;
  private readonly sessionDir: string;
  private readonly client: Client;

  private currentStatus: ClientStatus = 'initializing';
  private latestQR: string | null = null;
  private initialized = false;
  private isDestroying = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private browserTeardown: Promise<void> | null = null;
  private reconnectPreparation: Promise<void> | null = null;

  constructor(options: WhatsAppWebClientOptions) {
    super();

    this.businessId = options.businessId;
    this.sessionDir = options.sessionDir;

    // Ensure the session directory exists as a real directory.
    //
    // whatsapp-web.js's LocalAuth does statSync() reads against both
    // the outer dataPath and its nested ${dataPath}/${clientId} subdir
    // (it stores creds at the latter). If the directory was wiped
    // externally (e.g. operator deleted a stale session manually after
    // disconnect) AND the cleanup left a phantom file or broken symlink
    // in its place, mkdirSync for the nested dir throws ENOENT/ENOTDIR
    // and the salon's chromium never comes up.
    //
    // We resolve the path absolutely (CWD-independent), lstat it, and
    // if it's anything other than a directory we forcibly remove and
    // recreate. mkdirSync with recursive:true is idempotent for
    // valid existing directories.
    const absoluteSessionDir = path.resolve(this.sessionDir);
    this.sessionDir = absoluteSessionDir;
    try {
      const stat = fs.lstatSync(absoluteSessionDir);
      if (!stat.isDirectory()) {
        log.warn(
          {
            businessId: this.businessId,
            sessionDir: absoluteSessionDir,
            phantomKind: stat.isFile()
              ? 'regular-file'
              : stat.isSymbolicLink()
              ? 'symlink'
              : 'other',
          },
          'sessionDir is not a directory; removing phantom and recreating'
        );
        fs.rmSync(absoluteSessionDir, { recursive: true, force: true });
      }
    } catch {
      // doesn't exist — fine, mkdirSync will create it below
    }

    const localAuthDir = path.join(
      absoluteSessionDir,
      this.businessId
    );
    try {
      // Node's recursive mkdir is idempotent and works on every platform.
      fs.mkdirSync(localAuthDir, { recursive: true });
      // Defensive: sanity-check the directory really exists before
      // handing control to whatsapp-web.js.
      const verifyStat = fs.lstatSync(localAuthDir);
      if (!verifyStat.isDirectory()) {
        throw new Error(
          `mkdir succeeded but path is not a directory: ${localAuthDir}`
        );
      }
      log.info(
        { businessId: this.businessId, localAuthDir },
        'session dir ready'
      );
    } catch (e) {
      // Diagnostic — capture everything we can about the path's state.
      let outerExists = false;
      let outerIsDir = false;
      let outerIsFile = false;
      let outerIsSymlink = false;
      try {
        const outerStat = fs.lstatSync(absoluteSessionDir);
        outerExists = true;
        outerIsDir = outerStat.isDirectory();
        outerIsFile = outerStat.isFile();
        outerIsSymlink = outerStat.isSymbolicLink();
      } catch {}
      log.error(
        {
          businessId: this.businessId,
          sessionDir: absoluteSessionDir,
          localAuthDir,
          outerExists,
          outerIsDir,
          outerIsFile,
          outerIsSymlink,
          err: (e as Error).message,
          code: (e as NodeJS.ErrnoException).code,
        },
        'mkdirSync failed — sessions/ has an unresolvable entry'
      );
      throw e;
    }

    // Clear stale Chromium lockfiles before constructing the Client.
    // Safe because no other process should be touching this directory
    // — we own one session per salon.
    clearChromiumLocks(absoluteSessionDir);

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: this.businessId,
        dataPath: this.sessionDir,
      }),
      puppeteer: {
        headless: true,
        args: [
          // Sach Batao's exact Puppeteer flags — kept simple, no
          // anti-detection workarounds. We add detection workarounds
          // back one at a time ONLY if we confirm they're needed.
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      },

      // Give the library more time to authenticate before giving up.
      authTimeoutMs: 60_000,
      qrMaxRetries: 5,
    });

    this.setupEventHandlers();

    log.debug(
      { businessId: this.businessId, sessionDir: this.sessionDir },
      'client constructed'
    );
  }

  // -------------------------------------------------------------------------
  // Public getters — read-only views into client state
  // -------------------------------------------------------------------------

  get business(): string {
    return this.businessId;
  }

  get status(): ClientStatus {
    return this.currentStatus;
  }

  get qr(): string | null {
    return this.latestQR;
  }

  get ready(): boolean {
    return this.currentStatus === 'ready';
  }

  // -------------------------------------------------------------------------
  // State machine
  // -------------------------------------------------------------------------

  private setStatus(next: ClientStatus): void {
    if (this.currentStatus === next) return;
    const prev = this.currentStatus;
    this.currentStatus = next;
    log.info(
      { businessId: this.businessId, from: prev, to: next },
      'status change'
    );
    this.emit('status-change', {
      businessId: this.businessId,
      status: next,
    });
  }

  // -------------------------------------------------------------------------
  // WhatsApp-web.js event wiring
  // -------------------------------------------------------------------------

  private setupEventHandlers(): void {
    this.client.on('qr', (qr: string) => {
      this.latestQR = qr;
      this.setStatus('qr_pending');
      log.info(
        { businessId: this.businessId, qrLength: qr.length },
        'qr received; awaiting scan'
      );
    });

    this.client.on('authenticated', () => {
      this.latestQR = null;
      this.reconnectAttempts = 0;
      this.setStatus('authenticated');
      log.info({ businessId: this.businessId }, 'authenticated; syncing');
    });

    this.client.on('auth_failure', (msg: string) => {
      this.latestQR = null;
      log.error(
        { businessId: this.businessId, msg },
        'auth failure — session may need to be re-linked'
      );
      this.setStatus('expired');
    });

    this.client.on('ready', () => {
      this.latestQR = null;
      this.reconnectAttempts = 0;
      this.setStatus('ready');
      log.info({ businessId: this.businessId }, 'client ready');
    });

    this.client.on('disconnected', (reason: string) => {
      log.warn(
        { businessId: this.businessId, reason },
        'disconnected from whatsapp'
      );
      // logout()/destroy() can emit this event while intentionally closing.
      // Do not overwrite the terminal status or start a reconnect in that case.
      if (this.isDestroying) return;
      this.setStatus('disconnected');
      if (!this.reconnectPreparation) {
        this.reconnectPreparation = this.prepareReconnect().finally(() => {
          this.reconnectPreparation = null;
        });
      }
    });

    this.client.on('message', (msg: Message) => {
      // Fire-and-forget — handleIncomingMessage() handles its own errors,
      // and we don't want one bad message to break the event loop.
      this.handleIncomingMessage(msg).catch((e) => {
        log.error(
          { businessId: this.businessId, err: (e as Error).message },
          'message handler crashed (continuing)'
        );
      });
    });
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private async handleIncomingMessage(msg: Message): Promise<void> {
    // Filter out noise — only process real customer text messages.
    if (msg.fromMe) return;
    if (msg.isStatus) return;
    if (!msg.body || msg.body.trim().length === 0) return;

    // Only text messages for now. Voice/image/document get added later.
    // whatsapp-web.js uses 'chat' as the MessageTypes value for plain text.
    if (msg.type !== 'chat') return;

    const log = childLogger('whatsapp-web.client');
    let reply: string | null;
    try {
      // Hand the normalized message off to the main API for LLM/booking.
      // The main API owns the transport-agnostic business core; we own
      // chromium lifecycle. Reply text comes back over the same HTTP call.
      const result = await deliverInboundMessage({
        businessId: this.businessId,
        from: msg.from,
        text: msg.body,
        messageId: msg.id.id,
      });
      reply = result.reply;
    } catch (e) {
      log.error(
        { businessId: this.businessId, err: (e as Error).message },
        'deliverInboundMessage failed; dropping reply'
      );
      return;
    }

    if (reply) {
      await this.sendTextMessage(msg.from, reply);
    }

    // Emit for any external listeners (audit log, analytics, etc).
    this.emit('incoming-message', {
      businessId: this.businessId,
      from: msg.from,
      text: msg.body,
      messageId: msg.id.id,
    });
  }

  // -------------------------------------------------------------------------
  // Reconnection — exponential backoff, capped attempts
  // -------------------------------------------------------------------------

  private async prepareReconnect(): Promise<void> {
    if (this.isDestroying) return;
    try {
      await this.closeBrowser();
      await clearChromiumLocksWithRetry(this.sessionDir);
    } catch (e) {
      log.warn(
        { businessId: this.businessId, err: (e as Error).message },
        'browser cleanup before reconnect failed'
      );
    }
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    if (this.isDestroying) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error(
        { businessId: this.businessId, attempts: this.reconnectAttempts },
        'max reconnect attempts reached; marking session expired'
      );
      this.setStatus('expired');
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    );

    log.info(
      {
        businessId: this.businessId,
        attempt: this.reconnectAttempts,
        delayMs: delay,
      },
      'scheduling reconnect'
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isDestroying) return;
      this.closeBrowser()
        .then(() => clearChromiumLocksWithRetry(this.sessionDir))
        .then(() => this.client.initialize())
        .then(() => {
          log.info(
            { businessId: this.businessId },
            'reconnect succeeded'
          );
          // The 'ready' event will reset reconnectAttempts + emit status.
        })
        .catch((e) => {
          log.error(
            { businessId: this.businessId, err: (e as Error).message },
            'reconnect failed; will retry'
          );
          this.attemptReconnect();
        });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeBrowser(): Promise<void> {
    if (this.browserTeardown) return this.browserTeardown;
    this.browserTeardown = (async () => {
      const browser = this.client.pupBrowser;
      if (!browser?.isConnected()) return;
      const pid = browser.process()?.pid;
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.client.destroy(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('browser close timed out')),
              BROWSER_CLOSE_TIMEOUT_MS
            );
          }),
        ]);
      } catch (e) {
        log.warn(
          { businessId: this.businessId, pid, err: (e as Error).message },
          'graceful browser close failed; force-killing chromium'
        );
        await this.forceKillBrowser(pid);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, PROFILE_RELEASE_DELAY_MS));
    })().finally(() => {
      this.browserTeardown = null;
    });
    return this.browserTeardown;
  }

  private async forceKillBrowser(pid?: number): Promise<void> {
    if (!pid) return;
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
      });
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    }
  }

  // -------------------------------------------------------------------------
  // Public lifecycle API
  // -------------------------------------------------------------------------

  /**
   * Initialize the underlying whatsapp-web.js Client. Safe to call once;
   * subsequent calls are logged + no-op.
   */
  async initialize(): Promise<void> {
    if (this.isDestroying) {
      throw new Error('WhatsAppWebClient: cannot initialize while destroying');
    }
    if (this.initialized) {
      log.warn(
        { businessId: this.businessId },
        'initialize() called twice; ignoring'
      );
      return;
    }
    this.initialized = true;
    this.setStatus('initializing');

    try {
      await this.client.initialize();
    } catch (e) {
      this.initialized = false;
      this.setStatus('expired');
      throw e;
    }
  }

  /**
   * Send a text message back to a customer. The `to` may be in either
   * form (raw digits or @c.us chatId) — we normalize internally.
   *
   * Throws on failure (caller should log + decide whether to retry).
   */
  async sendTextMessage(to: string, text: string): Promise<void> {
    if (!this.ready) {
      log.warn(
        { businessId: this.businessId, status: this.currentStatus },
        'sendTextMessage called while not ready; message dropped'
      );
      throw new Error(
        `WhatsAppWebClient: cannot send — status is ${this.currentStatus}`
      );
    }

    const chatId = to.includes('@') ? to : `${to}@c.us`;
    try {
      await this.client.sendMessage(chatId, text);
      log.info(
        {
          businessId: this.businessId,
          to: chatId,
          length: text.length,
        },
        'message sent'
      );
    } catch (e) {
      log.error(
        {
          businessId: this.businessId,
          to: chatId,
          err: (e as Error).message,
        },
        'sendMessage failed'
      );
      throw e;
    }
  }

  /**
   * Explicitly unlink this Web session from WhatsApp, then tear Chromium
   * down. Unlike destroy(), logout() notifies WhatsApp and removes LocalAuth
   * credentials, so the device disappears from the phone's Linked Devices.
   */
  async logout(): Promise<void> {
    if (this.isDestroying) {
      throw new Error('WhatsAppWebClient: logout already in progress');
    }
    this.isDestroying = true;
    this.clearReconnectTimer();
    this.setStatus('destroyed');

    let logoutError: Error | null = null;
    try {
      await this.client.logout();
      log.info({ businessId: this.businessId }, 'whatsapp session logged out');
    } catch (e) {
      logoutError = e as Error;
      log.error(
        { businessId: this.businessId, err: logoutError.message },
        'whatsapp logout failed'
      );
    } finally {
      // logout() normally closes Chromium itself. This handles partial
      // failures and ensures no process retains the LocalAuth profile.
      await this.closeBrowser();
      await clearChromiumLocksWithRetry(this.sessionDir);
    }

    if (logoutError) throw logoutError;
  }

  /**
   * Gracefully tear down the Client. Called on SIGTERM/SIGINT or when
   * removing a salon from the session manager. Idempotent — safe to call
   * multiple times.
   */
  async destroy(): Promise<void> {
    if (this.isDestroying) {
      log.debug({ businessId: this.businessId }, 'destroy() already in progress');
      return;
    }
    this.isDestroying = true;
    this.clearReconnectTimer();
    this.setStatus('destroyed');

    try {
      await this.closeBrowser();
      await clearChromiumLocksWithRetry(this.sessionDir);
      log.info({ businessId: this.businessId }, 'client destroyed cleanly');
    } catch (e) {
      log.warn(
        {
          businessId: this.businessId,
          err: (e as Error).message,
        },
        'client destroy error (process may need manual cleanup)'
      );
    }
  }
}
