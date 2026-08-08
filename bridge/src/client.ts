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
  | 'code_pending'
  | 'authenticated'
  | 'ready'
  | 'disconnected'
  | 'expired'
  | 'destroyed';

/**
 * Which pairing handshake the salon owner chose. Default 'qr' — the
 * library boots into QR mode unless we explicitly call
 * client.requestPairingCode() (which flips this to 'phone'). The
 * qr-server surfaces this on the status response so the frontend
 * knows whether to render the QR or the XXXX-XXXX code.
 */
export type PairingMethod = 'qr' | 'phone';

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
  /**
   * Latest 8-char pairing code from the library's `code` event. Only
   * populated after requestPhonePairing() has been called and the
   * library has emitted at least one code. The library auto-rotates
   * every intervalMs (default 3 min) via an internal timer — we just
   * hold whatever the most recent value is. Null in QR-only mode.
   */
  private latestPairingCode: string | null = null;
  /**
   * Which pairing method the salon owner chose. Stays 'qr' (default)
   * unless requestPhonePairing() flips it to 'phone'. The qr-server
   * surfaces this so the modal can render the right UI.
   */
  private pairingMethod: PairingMethod = 'qr';
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

  /**
   * Most recent 8-char pairing code from the library, or null if the
   * salon hasn't started phone-pairing yet. Format from the library
   * is "ABCDEFGH" (no dashes) — callers should format as XXXX-XXXX
   * for display.
   */
  get pairingCode(): string | null {
    return this.latestPairingCode;
  }

  /**
   * Which pairing method is active for this salon. 'qr' (default)
   * until requestPhonePairing() flips it to 'phone'.
   */
  get method(): PairingMethod {
    return this.pairingMethod;
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

    // Phone-pairing handshake. The library emits this event when
    // requestPairingCode() is called (initial code + every intervalMs
    // rotation, default 3 min). We store the latest and flip status
    // to code_pending. The QR is no longer the active handshake in
    // this mode — clear it so the frontend doesn't render a stale QR
    // alongside the code.
    this.client.on('code', (code: string) => {
      this.latestPairingCode = code;
      this.latestQR = null;
      this.setStatus('code_pending');
      log.info(
        { businessId: this.businessId, codeLength: code.length },
        'pairing code received; awaiting phone entry'
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

    // -------------------------------------------------------------------
    // Retry the backend call with exponential backoff before giving up.
    //
    // Previously any single failure (timeout, 5xx, ECONNRESET) caused
    // the reply to be silently dropped — the customer would see
    // nothing on their end and the salon owner had no record of what
    // happened. That's worse than a stale reply because there's no
    // signal at all to debug.
    //
    // Strategy: 3 attempts with 1s/3s backoff (4th attempt NOT made
    // because by then the customer has long given up). Per-attempt
    // timeout is 10s so worst-case total is ~24s instead of 90s.
    //
    // On final failure: log a structured `dead-letter` entry with
    // everything needed to reconstruct the situation — owner can
    // grep the bridge log for this to see "X replies never reached
    // the customer today".
    // -------------------------------------------------------------------
    const MAX_DELIVERY_ATTEMPTS = 3;
    // Per-attempt timeout. The backend's LLM call legitimately
    // takes 20-70s on MiniMax-M3 (the model burns ~3.8K reasoning
    // tokens before producing JSON — see the diagnostic dump in
    // /lib/llm.ts). The LLM may also take 10-20s on a cold first
    // call (full prompt assembly + round-trip). 90s gives one good
    // retry window before we consider the message dead-lettered.
    // 3 attempts × 90s + 1s/3s backoff = ~274s worst case, which
    // is well above what we want but it surfaces real stalls — the
    // open question is whether we should switch to a faster model
    // rather than ride out this latency (see Step 1 reasoning
    // investigation).
    const PER_ATTEMPT_TIMEOUT_MS = 90_000;
    const BACKOFF_MS = [1_000, 3_000];

    let reply: string | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
      try {
        const result = await deliverInboundMessage(
          {
            businessId: this.businessId,
            from: msg.from,
            text: msg.body,
            messageId: msg.id.id,
          },
          { timeoutMs: PER_ATTEMPT_TIMEOUT_MS }
        );
        reply = result.reply;
        lastError = null;
        break; // success
      } catch (e) {
        lastError = e as Error;
        log.warn(
          {
            businessId: this.businessId,
            from: msg.from,
            messageId: msg.id.id,
            attempt,
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
            err: lastError.message,
          },
          'deliverInboundMessage failed; will retry'
        );
        if (attempt < MAX_DELIVERY_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
        }
      }
    }

    if (lastError) {
      // ----------------------------------------------------------------
      // Dead-letter: all retries exhausted. Log the full context so the
      // salon owner (or support) can reconstruct what happened. The
      // `dead-letter` tag is grep-friendly.
      //
      // Production next-step would be to also write this to a
      // `delivery_failures` table so it shows up in the inbox /
      // dashboard. For now, structured log is enough to act on.
      // ----------------------------------------------------------------
      log.error(
        {
          businessId: this.businessId,
          from: msg.from,
          messageId: msg.id.id,
          textLength: msg.body.length,
          textPreview: msg.body.slice(0, 80),
          attempts: MAX_DELIVERY_ATTEMPTS,
          finalError: lastError.message,
        },
        'dead-letter: deliverInboundMessage failed after all retries'
      );
      // Don't crash the bridge. Customer sees silence for THIS message
      // but the next message they send will be processed normally.
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
   * Switch this client from QR pairing to phone-number pairing.
   *
   * whatsapp-web.js exposes requestPairingCode() as a public API
   * (src/Client.js:514) — designed exactly for the "wait until
   * chromium is in a known-good state, then trigger pairing" pattern
   * that the QR handshake completes internally during initialize().
   *
   * Workflow:
   *   1. Caller already called initialize() — chromium boots, qr event
   *      fires briefly (we ignore it).
   *   2. Caller invokes requestPhonePairing(phoneNumber) — the
   *      library's requestPairingCode() waits internally for
   *      window.AuthStore.PairingCodeLinkUtils (it polls), then
   *      emits the 'code' event AND returns the first code string.
   *   3. The 'code' event listener above stores the code and flips
   *      status to 'code_pending'.
   *
   * Phone number format: raw digits, country code, no '+', no spaces.
   * Mirrors the library's example (96170100100). 8-15 digits per E.164.
   *
   * Throws on:
   *   - invalid phone format (sanity check before library call)
   *   - client not initialized (must be done first)
   *   - client destroying (mid-shutdown)
   *   - library error (puppeteer page evaluate failed)
   */
  async requestPhonePairing(phoneNumber: string): Promise<string> {
    if (this.isDestroying) {
      throw new Error(
        'WhatsAppWebClient: cannot request phone pairing while destroying'
      );
    }
    if (!this.initialized) {
      throw new Error(
        'WhatsAppWebClient: initialize() must run before requestPhonePairing()'
      );
    }

    // Library wants raw digits only — strip +/spaces/dashes defensively.
    // 8-15 digits matches E.164 spec; international numbers without a
    // leading '+' is the documented whatsapp-web.js format.
    const sanitized = (phoneNumber || '').replace(/[^0-9]/g, '');
    if (sanitized.length < 8 || sanitized.length > 15) {
      throw new Error(
        `Invalid phone number: expected 8-15 digits, got ${sanitized.length}`
      );
    }

    log.info(
      { businessId: this.businessId, phoneLength: sanitized.length },
      'requesting phone pairing code from library'
    );

    // Flip method BEFORE the await — the status endpoint needs to
    // report 'phone' the moment the call lands, not after the library
    // returns (which can take a few seconds on a cold chromium).
    this.pairingMethod = 'phone';

    try {
      // requestPairingCode returns the FIRST code; subsequent rotations
      // come through the 'code' event listener we registered above.
      const code = await this.client.requestPairingCode(sanitized);
      // Belt-and-suspenders: the 'code' event will also fire and store
      // this value, but we set it directly here in case the event races
      // with the poll cycle (the QRModal polls every 2.5s).
      this.latestPairingCode = code;
      this.latestQR = null;
      this.setStatus('code_pending');
      log.info(
        { businessId: this.businessId, codeLength: code.length },
        'phone pairing code returned from library'
      );
      return code;
    } catch (e) {
      // Restore qr-only state on failure so the user can fall back.
      this.pairingMethod = 'qr';
      log.error(
        { businessId: this.businessId, err: (e as Error).message },
        'requestPairingCode failed'
      );
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
