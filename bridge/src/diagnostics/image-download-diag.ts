/**
 * Wave 18 — temporary diagnostic dump for the upstream r:r
 * media-download regression in whatsapp-web.js.
 *
 * Captures four probes on every incoming image message:
 *
 *   Test 1: client.getWWebVersion()
 *           Is our webVersionCache pin actually in effect on the running
 *           chromium page? Verifies that we ARE bootstrapping against
 *           `2.3000.1042056473-alpha`.
 *
 *   Test 2: msg.id shape
 *           Does the message id expose `_serialized`, `$1`, or both?
 *           (Upstream `whatsapp-web.js` issue #201830 changed the format
 *           on WA Web `2.3000.1043xxx`. Some pinned pre-break versions
 *           still report the old shape.)
 *
 *   Test 3: WAWebCollections.Msg.get(candidate_id)
 *           For each ID candidate (`_serialized`, `$1`, and a manually
 *           reconstructed `fromMe_remote_id` form), does the WhatsApp
 *           IndexedDB-side lookup succeed? If a candidate works but
 *           the library uses another that doesn't, we know it's the
 *           id-encoding regression.
 *
 *   Test 4: WAWebDownloadManager.downloadManager.downloadAndMaybeDecrypt
 *           Called directly — bypassing the library wrapper that throws
 *           `r: r`. Captures the REAL exception (typed, with message
 *           and stack) instead of the opaque character that Puppeteer
 *           surfaces when the library collapses a thrown value.
 *
 * The dump emits two structured log lines per image:
 *   - `diag_test1_2_msg_id` (Node-side: Test 1 + Test 2)
 *   - `diag_tests_3_4_inpage` (Page-side: Test 3 + Test 4)
 *
 * This file is gated by `DIAGNOSE_IMAGE_DOWNLOAD=true` in the bridge
 * process. It does not replace the existing download path; it runs in
 * parallel and emits read-only diagnostics. The actual `msg.downloadMedia()`
 * path (or the short-circuit fallback) runs as before.
 *
 * Remove this file once an upstream fix lands and we have the actual
 * fix. The companion `IMAGES_PIPELINE_DOWNLOAD` flag in client.ts
 * becomes unnecessary at the same time.
 */

import { Message } from 'whatsapp-web.js';
import { childLogger } from '../logger';

const log = childLogger('whatsapp-web.client.diag');

export interface DiagClientLike {
  getWWebVersion(): Promise<string>;
  pupPage?: {
    evaluate<T>(
      fn: (...args: unknown[]) => T | Promise<T>,
      ...args: unknown[]
    ): Promise<T>;
  } | null;
}

/**
 * Run the four-probe diagnostic. Caller is `handleImageMessage`;
 * we deliberately don't throw — diagnostic failures must not interfere
 * with the live customer reply path.
 */
export async function diagnoseIncomingImage(
  client: DiagClientLike,
  msg: Message
): Promise<void> {
  try {
    // Test 1 — actual running WA Web version
    let waVersion = '<unavailable>';
    try {
      waVersion = await client.getWWebVersion();
    } catch (e) {
      waVersion = `<err: ${(e as Error).message ?? String(e)}>`;
    }

    // Test 2 — raw msg.id shape
    const idSerialized = (msg.id as unknown as { _serialized?: string })
      ?._serialized;
    const idDollar1 = (msg.id as unknown as { $1?: string }).$1;
    const idFromMe = (msg.id as unknown as { fromMe?: boolean }).fromMe;
    const idRemote = (msg.id as unknown as { remote?: string }).remote;
    const reconstructedId = `${idFromMe}_${idRemote}_${msg.id?.id}`;
    const idCandidates = [idSerialized, idDollar1, reconstructedId].filter(
      Boolean
    ) as string[];

    let idJson = '<serialize-err>';
    try {
      idJson = JSON.stringify(
        msg.id,
        (k, v) => (typeof v === 'function' ? '[fn]' : v),
        2
      );
    } catch {
      // circular or non-serializable
    }

    log.info(
      {
        businessId: (msg as unknown as { businessId?: string }).businessId,
        messageId: msg.id?.id,
        from: msg.from,
        waVersion,
        idSerialized,
        idDollar1,
        idCandidates,
        idJsonPreview: idJson.slice(0, 2000),
      },
      'diag_test1_2_msg_id'
    );

    if (!client.pupPage) {
      log.warn('diag_no_puppage_skipping_inpage_tests');
      return;
    }

    // Tests 3 + 4 inside the WA Web page
    const inPage = await client.pupPage.evaluate(async (...args: unknown[]) => {
      const candidates = (args[0] as string[]) ?? [];
      // We assert to any here because `window` is not a TS DOMWindow
      // type in this context; the runtime target is the WA Web page.
      const w = (globalThis as unknown) as { window?: unknown };
      const win = (
        typeof w.window !== 'undefined' ? (w.window as unknown) : (globalThis as unknown)
      ) as {
        require?: (m: string) => unknown;
      };
      type Out = Record<string, unknown>;
      const out: Out = {
        collectionsMod: false,
        candidateLookup: {} as Record<string, string>,
        chosenMsg: null,
        mediaInternals: null,
        downloadManagerCall: null,
      };

      let MsgMod:
        | { get?: (id: string) => Record<string, unknown> | null }
        | null = null;
      try {
        MsgMod = (
          win.require?.('WAWebCollections') as {
            Msg?: { get?: (id: string) => Record<string, unknown> | null };
          }
        )?.Msg ?? null;
        out.collectionsMod = !!MsgMod;
      } catch (e) {
        out.collectionsErr = (e as Error)?.message ?? String(e);
      }

      // Test 3 — try each ID candidate
      const lookup = out.candidateLookup as Record<string, string>;
      let chosenMsg: Record<string, unknown> | null = null;
      for (const sid of candidates) {
        try {
          const m = MsgMod?.get?.(sid) ?? null;
          lookup[sid] = m ? 'FOUND' : 'NOT_FOUND';
          if (m && !chosenMsg) chosenMsg = m;
        } catch (e) {
          lookup[sid] = `ERR: ${(e as Error)?.message ?? String(e)}`;
        }
      }
      out.chosenMsg = chosenMsg ? 'present' : 'absent';

      if (!chosenMsg) return out;

      const c = chosenMsg as Record<string, unknown>;
      // Read-only inspection of media-related fields. NOTE: mediaKey is
      // the AES key — never log raw bytes; only presence is fine.
      out.mediaInternals = {
        type: c.type,
        size: c.size,
        directPath: c.directPath,
        filehash: c.filehash,
        encFilehash: c.encFilehash,
        mediaKeyPresent: !!c.mediaKey,
        mediaKeyTimestamp: c.mediaKeyTimestamp,
        mediaStagePresent: !!(
          c.mediaData as Record<string, unknown> | undefined
        )?.mediaStage,
        mediaObjectPresent: !!c.mediaObject,
        mediaBlobPresent: !!(
          c.mediaObject as Record<string, unknown> | undefined
        )?.mediaBlob,
        forceToBlobPresent: !!(
          (
            c.mediaObject as Record<string, unknown> | undefined
          )?.mediaBlob as Record<string, unknown> | undefined
        )?.forceToBlob,
      };

      try {
        const cacheMod = win.require?.(
          'WAWebMediaInMemoryBlobCache'
        ) as
          | {
              InMemoryMediaBlobCache?: {
                get?: (h: unknown) =>
                  | { size?: number; constructor?: { name?: string } }
                  | null
                  | undefined;
              };
            }
          | undefined;
        const cached =
          cacheMod?.InMemoryMediaBlobCache?.get?.(
            (
              c.mediaObject as Record<string, unknown> | undefined
            )?.filehash
          ) ?? null;
        (
          out.mediaInternals as Record<string, unknown>
        ).blobCachePresent = !!cached;
        (
          out.mediaInternals as Record<string, unknown>
        ).blobCacheSize = cached?.size ?? null;
      } catch (e) {
        (out.mediaInternals as Record<string, unknown>).blobCacheErr =
          (e as Error)?.message ?? String(e);
      }

      // Test 4 — call DownloadManager.downloadAndMaybeDecrypt directly.
      // This is the function the library calls inside its broken wrapper.
      // We capture the REAL exception here, not the opaque `r: r`.
      if (c.directPath && c.mediaKey) {
        try {
          const dm = win.require?.('WAWebDownloadManager') as
            | {
                downloadManager?: {
                  downloadAndMaybeDecrypt?: (opts: unknown) => Promise<unknown>;
                };
              }
            | undefined;
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
          // 30s timeout — same shape as the library's own AbortController
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 30_000);
          const data = await dm?.downloadManager?.downloadAndMaybeDecrypt?.({
            directPath: c.directPath,
            encFilehash: c.encFilehash,
            filehash: c.filehash,
            mediaKey: c.mediaKey,
            mediaKeyTimestamp: c.mediaKeyTimestamp,
            type: c.type,
            signal: controller.signal,
            downloadQpl: qpl,
          });
          out.downloadManagerCall = {
            ok: true,
            byteLength:
              (data as { byteLength?: number } | null)?.byteLength ??
              (data as { length?: number } | null)?.length ??
              null,
            ctor: (data as { constructor?: { name?: string } } | null)
              ?.constructor?.name ?? typeof data,
          };
        } catch (e) {
          const err = e as Record<string, unknown> & {
            status?: number;
            statusText?: string;
            code?: string;
          };
          out.downloadManagerCall = {
            ok: false,
            type: typeof e,
            ctor: (e as { constructor?: { name?: string } })?.constructor?.name ?? null,
            name: err.name ?? null,
            message: err.message ?? null,
            stack:
              typeof err.stack === 'string'
                ? (err.stack as string).slice(0, 1200)
                : null,
            status: err.status ?? null,
            statusText: err.statusText ?? null,
            code: err.code ?? null,
            stringified: String(e),
          };
        }
      } else {
        out.downloadManagerCall = 'skipped — missing directPath or mediaKey';
      }

      return out;
    }, idCandidates);

    log.info(
      {
        businessId: (msg as unknown as { businessId?: string }).businessId,
        messageId: msg.id?.id,
        ...(inPage as Record<string, unknown>),
      },
      'diag_tests_3_4_inpage'
    );
  } catch (e) {
    log.error(
      {
        err: (e as Error).message ?? String(e),
        stack: (e as Error).stack?.slice(0, 1500),
      },
      'diag_crashed'
    );
  }
}
