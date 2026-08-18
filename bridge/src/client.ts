import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { childLogger } from './logger';
import { clearChromiumLocks, clearChromiumLocksWithRetry } from './clear-locks';
import { deliverInboundMessage } from './bridge-client';
import { diagnoseIncomingImage } from './diagnostics/image-download-diag';
import { downloadMediaViaWWeb } from './media-download';
import {
  handleVoiceNote,
  MessageDedupe,
  VoiceNoteRateLimit,
  type VoiceNoteContext,
} from './voice-note';

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

  // ─── voice-note plumbing ─────────────────────────────────────────────────
  // Per-business dedupe + rate-limit. Single bridge replica today, so
  // process-local state is fine. See voice-note/dedupe.ts and
  // voice-note/rate-limit.ts for the semantics.
  private readonly voiceNoteDedupe: MessageDedupe;
  private readonly voiceNoteRateLimit: VoiceNoteRateLimit;
  private readonly voiceNotesEnabled: boolean;
  private readonly groqApiKey: string;
  private readonly maxVoiceDurationSec: number;
  private readonly voiceNoteClarification: string;

  // ─── image plumbing (Wave 18) ────────────────────────────────────────────
  // Reuses MessageDedupe for LRU dedupe on messageId. Per-phone rate
  // limiting is intentionally omitted in MVP — image LLM calls are
  // expensive (multimodal) but customer abuse of image sending is rare
  // in practice. The downstream backend's image-analysis call itself
  // is the cost gate. Add a rate limit later if abuse appears.
  private readonly imageDedupe: MessageDedupe;
  private readonly imagesEnabled: boolean;
  private readonly imageDownloadEnabled: boolean;
  private readonly maxImageBytes: number;
  private readonly imageClarification: string;
  private readonly diagnoseImageDownloadEnabled: boolean;

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

    // Voice-note initialization. Each WhatsAppWebClient owns its own
    // dedupe + rate-limit so per-business limits don't bleed across salons
    // when the bridge bootstraps multiple sessions. ENABLE_VOICE_NOTES is
    // checked once and cached — flipping the env var requires a restart.
    this.voiceNotesEnabled = process.env.ENABLE_VOICE_NOTES === 'true';
    this.groqApiKey = process.env.GROQ_API_KEY ?? '';
    this.maxVoiceDurationSec =
      Number(process.env.MAX_VOICE_DURATION_SEC) || 120;
    this.voiceNoteDedupe = new MessageDedupe(1000);
    this.voiceNoteRateLimit = new VoiceNoteRateLimit();
    this.voiceNoteClarification =
      "Sorry, I couldn't understand that voice note clearly. Could you type your message or resend?";

    // Image (Wave 18). ENABLE_IMAGES is the master switch — when off,
    // the bridge silently drops image messages at the dispatch switch
    // (preserves today's behavior). Default off until the backend's
    // image-analysis path is verified in production.
    this.imagesEnabled = process.env.ENABLE_IMAGES === 'true';
    // Wave-18 fix for the upstream whatsapp-web.js r:r regression
    // (issue #201828, PR #201840). While the bug is in effect, skip
    // the broken download path entirely and hand the customer the
    // clarification text instead. Operators flip this to true once a
    // patched whatsapp-web.js release is installed.
    this.imageDownloadEnabled =
      process.env.IMAGES_PIPELINE_DOWNLOAD === 'true';
    this.diagnoseImageDownloadEnabled =
      process.env.DIAGNOSE_IMAGE_DOWNLOAD === 'true';
    // 5MB cap — matches the bridge's 90s per-attempt timeout budget
    // for forwarding base64 inline (1.3x JSON inflation + 90s window).
    // Anything larger would balloon the JSON payload and risk the
    // backend rejecting it.
    this.maxImageBytes = Number(process.env.MAX_IMAGE_BYTES) || 5 * 1024 * 1024;
    this.imageDedupe = new MessageDedupe(500);
    this.imageClarification =
      "Got your photo — someone from the team will follow up shortly.";

    log.debug(
      {
        businessId: this.businessId,
        sessionDir: this.sessionDir,
        imagesEnabled: this.imagesEnabled,
        maxImageBytes: this.maxImageBytes,
      },
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
      // Fire-and-forget — dispatchInboundMessage() handles its own errors,
      // and we don't want one bad message to break the event loop.
      this.dispatchInboundMessage(msg).catch((e) => {
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

  /**
   * Top-level dispatcher. Filters out noise (statuses, own messages) and
   * routes by `msg.type`:
   *   - 'chat'      → handleTextMessage
   *   - 'ptt'       → handleVoiceNoteMessage (PTT voice notes)
   *   - 'audio'     → handleVoiceNoteMessage (shared audio files)
   *   - 'image'     → handleImageMessage (Wave 18 — multimodal analysis)
   *   - anything else (document, sticker, video, ...) → drop silently
   *
   * Each handler is responsible for its own retry/dead-letter logic via
   * `deliverWithRetry`.
   */
  private async dispatchInboundMessage(msg: Message): Promise<void> {
    if (msg.fromMe) return;
    if (msg.isStatus) return;
    if (!msg.from) return;

    switch (msg.type) {
      case 'chat':
        if (!msg.body || msg.body.trim().length === 0) return;
        return this.handleTextMessage(msg);
      case 'ptt':
      case 'audio':
        return this.handleVoiceNoteMessage(msg);
      case 'image':
        return this.handleImageMessage(msg);
      default:
        return; // drop silently (document, sticker, video, etc.)
    }
  }

  /**
   * Plain-text customer message. Mirrors the pre-voice-note behavior
   * exactly — same retry loop, same dead-letter shape, same reply send.
   */
  private async handleTextMessage(msg: Message): Promise<void> {
    const log = childLogger('whatsapp-web.client');

    const reply = await this.deliverWithRetry({
      text: msg.body,
      from: msg.from,
      messageId: msg.id.id,
      kind: 'text',
      deadLetterFields: {
        textLength: msg.body.length,
        textPreview: msg.body.slice(0, 80),
      },
      log,
    });

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

  /**
   * Voice-note (PTT) or shared audio. Two phases:
   *   1. handleVoiceNote() — download → Groq → validate → return transcript
   *      (or a skip reason: too short, dedupe, rate-limited, etc.)
   *   2. If a transcript came back, deliver it through the same retry loop
   *      used for text. The customer sees a text reply as if they had
   *      typed it.
   *
   * On empty_or_noise or transcribe_failed we send a one-line clarification
   * so the customer isn't left wondering. All other skip reasons drop
   * silently with a structured log.
   */
  private async handleVoiceNoteMessage(msg: Message): Promise<void> {
    const log = childLogger('whatsapp-web.client');

    const result = await handleVoiceNote(msg, this.businessId, {
      voiceNotesEnabled: this.voiceNotesEnabled,
      clientReady: this.currentStatus === 'ready',
      dedupe: this.voiceNoteDedupe,
      rateLimit: this.voiceNoteRateLimit,
      maxDurationSec: this.maxVoiceDurationSec,
      groqApiKey: this.groqApiKey,
      // Wave 18: route voice notes through the WA-Web-native downloader
      // to bypass the upstream r:r regression in msg.downloadMedia()
      // (whatsapp-web.js issue #201828). Voice notes share the same
      // root cause as images — same library call, same bug, same fix.
      downloader: (m: Message) => downloadMediaViaWWeb(this.client, m),
    });

    if (result.ok) {
      const reply = await this.deliverWithRetry({
        text: result.text,
        from: msg.from,
        messageId: msg.id.id,
        kind: 'voice-note',
        deadLetterFields: {
          transcriptLength: result.text.length,
          transcriptPreview: result.text.slice(0, 80),
          groqLatencyMs: result.latencyMs,
          whisperModel: result.model,
          msgDurationSec: result.durationSec,
          msgFilesize: result.filesize,
        },
        log,
      });
      if (reply) {
        await this.sendTextMessage(msg.from, reply);
      }
      // Still emit for audit — owner can see voice notes in inbox.
      this.emit('incoming-message', {
        businessId: this.businessId,
        from: msg.from,
        text: result.text,
        messageId: msg.id.id,
      });
      return;
    }

    // Failure / skip path. Most reasons are silent drops; empty_or_noise,
    // transcribe_failed, and download_failed get a clarification text so
    // the customer doesn't think the bot is broken. download_failed
    // specifically tells the user to try again — usually a transient
    // session-state issue on a freshly-paired client.
    if (
      result.reason === 'empty_or_noise' ||
      result.reason === 'transcribe_failed' ||
      result.reason === 'download_failed'
    ) {
      log.info(
        {
          businessId: this.businessId,
          from: msg.from,
          messageId: msg.id.id,
          reason: result.reason,
          reasonMessage: result.message,
        },
        'voice_note_sending_clarification'
      );
      try {
        await this.sendTextMessage(msg.from, this.voiceNoteClarification);
      } catch (e) {
        const errDump = (e as { message?: string; toString?: () => string });
        log.warn(
          {
            businessId: this.businessId,
            err: errDump.message ?? errDump.toString?.() ?? String(e),
          },
          'voice_note_clarification_send_failed'
        );
      }
    }
  }

  /**
   * Image-message handler (Wave 18).
   *
   * PRIVACY NOTES (see also `image-analysis.ts` header in backend):
   *   - Raw image bytes go to a single LLM provider per call
   *     (MiniMax M3 primary, Gemini 2.5 Flash-Lite fallback). Customer
   *     identifiers (name, phone, business name) are NEVER sent — only
   *     the base64 bytes + mime type + optional caption.
   *   - The base64 payload is NOT persisted server-side. The bridge
   *     forwards it once and forgets; the backend uses it once and
   *     forgets; the only thing kept is the structured analysis in
   *     `image_analysis_logs` (description, intent notes, draft reply)
   *     — never the bytes themselves.
   *   - ENABLE_IMAGES must be set in the bridge env before this
   *     handler runs in production. Ship with it OFF by default;
   *     flip ON only after the Privacy / Terms disclosure lands and
   *     providers' data-retention terms are reviewed.
   *
   * Flow:
   *   1. Feature flag (ENABLE_IMAGES). Off → silent drop.
   *   2. Sanity: msg.from + clientReady + msg.hasMedia.
   *   3. Dedupe on messageId (LRU) so redeliveries don't double-call.
   *   4. Download via msg.downloadMedia() — returns
   *      { data: <base64>, mimetype, filesize }.
   *   5. Filesize cap (post-download) — protects against huge photos
   *      blowing past our 90s per-attempt timeout.
   *   6. Mimetype whitelist — image/* only.
   *   7. Forward to backend with retry — image kind. Backend's
   *      message-handler branches on opts.media.kind === 'image'
   *      and routes through image-analysis.
   *
   * Failure paths:
   *   - download_failed / too_large / unsupported_mime  → send the
   *     clarification text so the customer isn't left wondering.
   *   - dedupe_hit / not_ready / no_media / disabled     → silent
   *     drop with a structured log.
   */
  private async handleImageMessage(msg: Message): Promise<void> {
    const log = childLogger('whatsapp-web.client');

    // 0. Wave-18 diagnostic dump for the upstream r:r regression. Off by
    // default — flip DIAGNOSE_IMAGE_DOWNLOAD=true in bridge/.env when
    // investigating. Runs BEFORE the short-circuit and feature gates so
    // it captures data regardless of whether we attempt the download.
    // The diagnostic never throws back into this handler.
    if (this.diagnoseImageDownloadEnabled) {
      await diagnoseIncomingImage(this.client, msg);
    }

    // 1a. Download-pipeline gate. While the upstream whatsapp-web.js
    // r:r regression (issue #201828) is in effect we never call the
    // broken msg.downloadMedia(); we just send the clarification text.
    // Re-enable by flipping IMAGES_PIPELINE_DOWNLOAD=true once PR
    // #201840 lands in a published release.
    if (!this.imageDownloadEnabled) {
      log.info(
        {
          businessId: this.businessId,
          from: msg.from,
          messageId: msg.id?.id,
          reason: 'pipeline_disabled',
        },
        'image_pipeline_short_circuited'
      );
      await this.sendImageClarification(msg.from, log);
      return;
    }

    // 1. Feature flag.
    if (!this.imagesEnabled) {
      log.debug(
        {
          businessId: this.businessId,
          from: msg.from,
          messageId: msg.id?.id,
        },
        'image_messages_disabled_drop'
      );
      return;
    }

    // 2. Sanity.
    if (!msg.from) {
      log.debug('image_no_from_drop');
      return;
    }
    if (this.currentStatus !== 'ready') {
      log.info({ status: this.currentStatus }, 'image_during_init_drop');
      return;
    }
    if (!msg.hasMedia) {
      log.debug('image_no_media_drop');
      return;
    }

    // 3. Dedupe on messageId.
    if (msg.id?.id && this.imageDedupe.seenBefore(msg.id.id)) {
      log.info({ messageId: msg.id.id }, 'image_dedupe_hit');
      return;
    }

    // 4. Download. whatsapp-web.js returns
    //    { data: <base64 string>, mimetype: string, filesize?: number }
    //    or throws. The library sometimes throws non-Error values, so
    //    we defensively String()-coerce like voice-note/handler.ts does.
    let media;
    try {
      // Wave-18 fix: replace the library's broken msg.downloadMedia()
      // (which throws "r: r" on WA Web ≥ 2.3000.1043xxx because of the
      // _serialized → $1 rename, upstream issue #201830) with our own
      // equivalent in media-download.ts. Uses `_serialized ?? $1 ?? reconstructed`
      // for the WAWebCollections.Msg lookup and calls
      // WAWebDownloadManager.downloadAndMaybeDecrypt directly.
      media = await downloadMediaViaWWeb(this.client, msg);
    } catch (e) {
      const errString = (() => {
        try {
          return String(e);
        } catch {
          return '<unstringifiable>';
        }
      })();
      log.warn(
        {
          businessId: this.businessId,
          from: msg.from,
          messageId: msg.id?.id,
          err: errString,
          errType: (e as Error)?.name ?? typeof e,
          hasMedia: msg.hasMedia,
          msgType: msg.type,
        },
        'image_download_failed'
      );
      await this.sendImageClarification(msg.from, log);
      return;
    }

    if (!media?.data) {
      log.warn(
        {
          businessId: this.businessId,
          from: msg.from,
          messageId: msg.id?.id,
        },
        'image_download_empty'
      );
      await this.sendImageClarification(msg.from, log);
      return;
    }

    log.info(
      {
        businessId: this.businessId,
        from: msg.from,
        messageId: msg.id?.id,
        mimetype: media.mimetype,
        filesize: media.filesize,
        captionLength: (msg.body ?? '').length,
      },
      'image_downloaded'
    );

    // 5. Filesize cap (post-download, since `msg` doesn't expose
    //    filesize for images in all library versions).
    const filesize = media.filesize ?? estimateBase64Size(media.data);
    if (filesize > this.maxImageBytes) {
      log.info(
        { filesize, cap: this.maxImageBytes },
        'image_too_large_drop'
      );
      await this.sendImageClarification(msg.from, log);
      return;
    }

    // 6. Mimetype whitelist — image/* only.
    const mimeType = (media.mimetype || 'image/jpeg').toLowerCase();
    if (!mimeType.startsWith('image/')) {
      log.info(
        { mimeType, businessId: this.businessId },
        'image_unsupported_mime_drop'
      );
      await this.sendImageClarification(msg.from, log);
      return;
    }

    // 7. Forward to backend. Caption (if any) goes in `text` so the
    //    backend's image-analysis helper can include it as optional
    //    context for the LLM.
    const caption = (msg.body ?? '').trim();

    const reply = await this.deliverWithRetry({
      text: caption,
      from: msg.from,
      messageId: msg.id.id,
      kind: 'image',
      media: {
        kind: 'image' as const,
        base64: media.data,
        mimeType,
        filesize,
      },
      deadLetterFields: {
        mimeType,
        filesize,
        captionLength: caption.length,
      },
      log,
    });

    if (reply) {
      try {
        await this.sendTextMessage(msg.from, reply);
      } catch (e) {
        log.warn(
          {
            businessId: this.businessId,
            from: msg.from,
            err: (e as Error).message ?? String(e),
          },
          'image_reply_send_failed'
        );
      }
    }

    // Emit for audit — owner can see image turns in the inbox.
    this.emit('incoming-message', {
      businessId: this.businessId,
      from: msg.from,
      text: `[Image${caption ? ` — "${caption.slice(0, 80)}"` : ''}]`,
      messageId: msg.id.id,
    });
  }

  /**
   * Send the image-failure clarification so the customer doesn't see
   * silence. Mirrors the voice-note clarification path.
   */
  private async sendImageClarification(
    from: string,
    log: ReturnType<typeof childLogger>
  ): Promise<void> {
    try {
      await this.sendTextMessage(from, this.imageClarification);
    } catch (e) {
      log.warn(
        { from, err: (e as Error).message ?? String(e) },
        'image_clarification_send_failed'
      );
    }
  }

  /**
   * Shared retry-with-backoff helper. Used by both text and voice-note
   * paths to keep delivery semantics identical. Returns the bot's reply
   * text on success, or null if all retries were exhausted (in which case
   * the dead-letter has already been logged).
   *
   * Per-attempt timeout: 90s (matches the prior text-message behavior;
   * the backend's LLM call legitimately takes 20-70s on MiniMax-M3).
   * 3 attempts × 90s + 1s/3s backoff ≈ ~274s worst case.
   *
   * The `kind` discriminator lets dead-letter logs distinguish text from
   * voice-note failures in production log search.
   */
  private async deliverWithRetry(args: {
    text: string;
    from: string;
    messageId: string;
    kind: 'text' | 'voice-note' | 'image';
    /** Optional image media payload (Wave 18). When set, the backend
     *  routes through image-analysis instead of the text LLM. The
     *  payload includes base64 bytes — kept inline (no multipart) to
     *  match the existing /api/bridge/inbound contract. */
    media?: {
      kind: 'image';
      base64: string;
      mimeType: string;
      filesize?: number;
    };
    deadLetterFields: Record<string, unknown>;
    log: ReturnType<typeof childLogger>;
  }): Promise<string | null> {
    const MAX_DELIVERY_ATTEMPTS = 3;
    const PER_ATTEMPT_TIMEOUT_MS = 90_000;
    const BACKOFF_MS = [1_000, 3_000];

    let reply: string | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
      try {
        const result = await deliverInboundMessage(
          {
            businessId: this.businessId,
            from: args.from,
            text: args.text,
            messageId: args.messageId,
            media: args.media,
          },
          { timeoutMs: PER_ATTEMPT_TIMEOUT_MS }
        );
        reply = result.reply;
        lastError = null;
        break; // success
      } catch (e) {
        lastError = e as Error;
        args.log.warn(
          {
            businessId: this.businessId,
            from: args.from,
            messageId: args.messageId,
            kind: args.kind,
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
      // Dead-letter: all retries exhausted. Structured log so support can
      // grep for 'dead-letter' and see "X replies never reached the
      // customer today". `kind` discriminator separates text from voice-note
      // failures.
      args.log.error(
        {
          businessId: this.businessId,
          from: args.from,
          messageId: args.messageId,
          kind: args.kind,
          attempts: MAX_DELIVERY_ATTEMPTS,
          finalError: lastError.message,
          ...args.deadLetterFields,
        },
        'dead-letter: deliverInboundMessage failed after all retries'
      );
      return null;
    }

    return reply;
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

// ─── module-level helpers ──────────────────────────────────────────────────

/**
 * Best-effort base64 → byte size estimate. whatsapp-web.js returns
 * media.data as a base64 string but doesn't always populate filesize
 * for image messages. Inflates by ~4/3, so length/4*3 is an upper
 * bound — good enough for a "is this under MAX_IMAGE_BYTES" guard.
 *
 * Same shape as voice-note/handler.ts:estimateBase64Size so we don't
 * need to import across the two modules.
 */
function estimateBase64Size(b64: string): number {
  return Math.ceil((b64.length * 3) / 4);
}
