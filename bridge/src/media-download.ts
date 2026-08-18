/**
 * Wave 18 — replacement for the library's broken `msg.downloadMedia()`.
 *
 * The upstream `whatsapp-web.js@1.34.7` package throws `r: r` when its
 * `Msg.prototype.downloadMedia` runs against recent WhatsApp Web
 * (≥ 2.3000.1043xxx). Root cause: the library looks up the message via
 * `WAWebCollections.Msg.get(msg.id._serialized)` but modern WA Web has
 * renamed that field to `$1` (upstream issue #201830). With no
 * `_serialized`, the IndexedDB lookup fails, and Puppeteer surfaces the
 * minified WA Web exception as the opaque string `"r"`.
 *
 * Verified via the diagnostic dump on 2026-08-18: calling
 * `WAWebDownloadManager.downloadAndMaybeDecrypt({...})` directly with
 * `_serialized ?? $1` returns a 32372-byte ArrayBuffer, byte-for-byte
 * matching `msg.size`.
 *
 * This module replicates the library's flow with the corrected ID path:
 *
 *   1. Build id candidates in priority order: _serialized, $1, the manual
 *      `${fromMe}_${remote}_${id}` reconstruction
 *   2. Inside pupPage.evaluate:
 *      a. Look the msg up via WAWebCollections.Msg.get(id)
 *      b. Pull directPath / mediaKey / encFilehash / filehash / type
 *      c. Call WAWebDownloadManager.downloadAndMaybeDecrypt(...) with
 *         an inline QPL shim and a 90s AbortController (matching the
 *         library's previous default)
 *      d. Convert ArrayBuffer → base64
 *   3. Return { data, mimetype, filesize } — same shape as the library
 *
 * Throws on any error. The caller (`handleImageMessage`) wraps the
 * call in its existing try/catch and sends the clarification text on
 * failure, identical to today's behavior for `msg.downloadMedia()`.
 *
 * When the upstream patch (or a release containing PR #201840) ships,
 * delete this module and revert to `msg.downloadMedia()`. The
 * `IMAGES_PIPELINE_DOWNLOAD` kill switch in client.ts becomes
 * unnecessary at the same time.
 */

import { Message } from 'whatsapp-web.js';

export interface MediaPayload {
  data: string; // base64
  mimetype: string;
  filesize: number;
}

export interface WWebClientLike {
  pupPage?: {
    evaluate<T>(
      fn: (...args: unknown[]) => T | Promise<T>,
      ...args: unknown[]
    ): Promise<T>;
  } | null;
}

/**
 * Download a media message's bytes from WhatsApp Web, bypassing the
 * library's broken `Msg.prototype.downloadMedia` wrapper.
 *
 * @throws Error if the lookup or download fails for any reason.
 *         The caller is expected to catch and surface a clarification.
 */
export async function downloadMediaViaWWeb(
  client: WWebClientLike,
  msg: Message
): Promise<MediaPayload> {
  if (!client.pupPage) {
    throw new Error('pupPage unavailable — client not initialized');
  }

  // Build id candidates in priority order — matches Test 3 in
  // bridge/src/diagnostics/image-download-diag.ts.
  const idSerialized = (msg.id as unknown as { _serialized?: string })
    ?._serialized;
  const idDollar1 = (msg.id as unknown as { $1?: string }).$1;
  const idFromMe = (msg.id as unknown as { fromMe?: boolean }).fromMe;
  const idRemote = (msg.id as unknown as { remote?: string }).remote;
  const reconstructed = `${idFromMe}_${idRemote}_${msg.id?.id}`;
  const msgId = idSerialized ?? idDollar1 ?? reconstructed;

  if (!msgId) {
    throw new Error(
      `Cannot construct a message id from msg.id=${JSON.stringify(msg.id)}`
    );
  }

  const result = await client.pupPage.evaluate(
    async (...args: unknown[]) => {
      const [idArg] = args as [string];

      const w = globalThis as { window?: unknown };
      const win = (
        typeof w.window !== 'undefined'
          ? (w.window as unknown)
          : globalThis
      ) as {
        require?: (m: string) => unknown;
      };

      // Step 1 — message lookup with the correct id shape
      const MsgMod = (
        win.require?.('WAWebCollections') as
          | {
              Msg?: {
                get?: (id: string) => Record<string, unknown> | null;
              };
            }
          | undefined
      )?.Msg;
      const m = MsgMod?.get?.(idArg) ?? null;

      if (!m) {
        throw new Error(
          `Msg.get(${JSON.stringify(idArg)}) returned null — message not in cache`
        );
      }

      const c = m as Record<string, unknown>;

      // Step 2 — required fields
      if (!c.directPath) {
        throw new Error('Message has no directPath yet — media not staged');
      }
      if (!c.mediaKey) {
        throw new Error('Message has no mediaKey yet — media not staged');
      }

      // Step 3 — QPL shim. Inlined because puppeteer's evaluate only
      // ships the function body — module-scope refs don't travel.
      const qpl: Record<string, unknown> = {};
      const qplChain = [
        'addAnnotations',
        'addPoint',
        'mark',
        'addArg',
        'time',
        'timeEnd',
        'track',
      ];
      for (const k of qplChain) qpl[k] = () => qpl;
      qpl.flush = () => Promise.resolve();
      qpl.end = () => Promise.resolve();
      qpl.panic = () => Promise.resolve();

      // Step 4 — download with timeout. 90s matches the library's
      // previous default. Note: this must be inline since module-scope
      // consts don't ship with puppeteer's evaluate callback.
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 90_000);

      const dm = win.require?.('WAWebDownloadManager') as
        | {
            downloadManager?: {
              downloadAndMaybeDecrypt?: (
                opts: unknown
              ) => Promise<unknown>;
            };
          }
        | undefined;

      const data =
        await dm?.downloadManager?.downloadAndMaybeDecrypt?.({
          directPath: c.directPath,
          encFilehash: c.encFilehash,
          filehash: c.filehash,
          mediaKey: c.mediaKey,
          mediaKeyTimestamp: c.mediaKeyTimestamp,
          type: c.type,
          signal: controller.signal,
          downloadQpl: qpl,
        });

      if (!data) {
        throw new Error('WAWebDownloadManager returned null/undefined');
      }

      // Step 5 — ArrayBuffer → base64, chunked to avoid stack overflow.
      // 32 KB chunks keep String.fromCharCode.apply below V8 stack limit.
      let u8: Uint8Array;
      if (data instanceof Uint8Array) {
        u8 = data;
      } else if (data instanceof ArrayBuffer) {
        u8 = new Uint8Array(data);
      } else {
        throw new Error(
          `Unexpected download result shape: ${typeof data} ${
            (data as { constructor?: { name?: string } })?.constructor
              ?.name
          }`
        );
      }

      let binary = '';
      for (let i = 0; i < u8.length; i += 0x8000) {
        binary += String.fromCharCode.apply(
          null,
          u8.subarray(i, i + 0x8000) as unknown as number[]
        );
      }
      const btoaFn = (globalThis as { btoa?: (s: string) => string }).btoa;
      if (typeof btoaFn !== 'function') {
        throw new Error('page global btoa() not available');
      }
      const base64 = btoaFn(binary);

      return {
        data: base64,
        filesize: u8.length,
      };
    },
    msgId
  );

  const r = result as { data?: unknown; filesize?: unknown };
  if (typeof r?.data !== 'string' || typeof r?.filesize !== 'number') {
    throw new Error(
      `DownloadManager evaluation returned unexpected shape: ${JSON.stringify(
        r
      ).slice(0, 200)}`
    );
  }

  return {
    data: r.data,
    mimetype:
      (msg as unknown as { mimetype?: string }).mimetype ?? 'image/jpeg',
    filesize: r.filesize,
  };
}
