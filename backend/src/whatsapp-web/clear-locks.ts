import fs from 'fs';
import path from 'path';
import { childLogger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Chromium lockfile scrubber.
//
// Chromium creates lockfiles in its userDataDir to enforce single-instance
// behavior. On persistent volumes (Docker bind-mounts, VPS disks), these
// lockfiles survive unclean shutdowns (SIGKILL, OOM, container crash).
// The next puppeteer.launch() then fails with exit code 21 because Chromium
// thinks another instance is already running.
//
// We scrub them before whatsapp-web.js initialize(). It's safe because we're
// the only process that should be touching this directory — only one
// WhatsApp-web.js Client per salon session path.
//
// Original pattern observed in codewithfourtix/sachbatao (MIT, MIT).
// Adapted: recursive walk (handles Default/, Crashpad/ subdirs), structured
// error reporting, no silent failures.
// ---------------------------------------------------------------------------

const log = childLogger('whatsapp-web.clear-locks');

/**
 * Chromium lockfile basenames to remove. These are the files Chromium
 * leaves behind on unclean shutdown to indicate "another instance owns
 * this profile dir".
 */
const LOCK_FILE_BASENAMES: ReadonlySet<string> = new Set([
  'SingletonLock',
  'SingletonCookie',
  'SingletonCookieExpire',
  'SingletonSocket',
]);

/**
 * Chromium also creates IPC socket files named like
 * `.org.chromium.Chromium.XXXXX`. Match those by prefix.
 */
const CHROMIUM_IPC_PREFIX = '.org.chromium.Chromium.';

export interface ClearLocksResult {
  /** Files actually removed, as paths relative to sessionDir. */
  cleared: string[];
  /** Files we tried to remove but couldn't. Best-effort — caller decides. */
  errors: string[];
}

/**
 * Recursively walk a directory and remove any chromium lock files.
 *
 * Best-effort: a failure to remove one file does not stop the walk.
 * The caller can inspect the result for diagnostics, but should NOT
 * treat errors as fatal — whatsapp-web.js initialize() will fail loudly
 * on its own if a real lockfile is still in place, and that's the
 * authoritative signal.
 *
 * @param sessionDir  The whatsapp-web.js LocalAuth dataPath for a salon.
 *                    Typically `dataPath/<salon-id>` from the session manager.
 */
export function clearChromiumLocks(sessionDir: string): ClearLocksResult {
  const result: ClearLocksResult = { cleared: [], errors: [] };

  if (!fs.existsSync(sessionDir)) {
    // First run for this salon — no session directory yet. This is normal
    // and not an error condition.
    log.debug({ sessionDir }, 'session dir does not exist; nothing to clear');
    return result;
  }

  const stat = fs.statSync(sessionDir);
  if (!stat.isDirectory()) {
    result.errors.push(
      `clearChromiumLocks: ${sessionDir} is not a directory`
    );
    return result;
  }

  walk(sessionDir, sessionDir, result);

  if (result.cleared.length > 0) {
    log.info(
      { count: result.cleared.length, sessionDir },
      'cleared chromium lock files'
    );
  }
  if (result.errors.length > 0) {
    log.warn(
      { count: result.errors.length, sessionDir },
      'some lock files could not be removed (will still attempt initialize)'
    );
  }

  return result;
}

function walk(
  rootDir: string,
  currentDir: string,
  result: ClearLocksResult
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch (e) {
    result.errors.push(`readdir ${currentDir}: ${(e as Error).message}`);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories. Chromium's profile layout has Default/
      // and Crashpad/ as common subdirs that may contain their own lockfiles.
      walk(rootDir, fullPath, result);
      continue;
    }

    const isLockFile =
      LOCK_FILE_BASENAMES.has(entry.name) ||
      entry.name.startsWith(CHROMIUM_IPC_PREFIX);

    if (!isLockFile) continue;

    try {
      fs.unlinkSync(fullPath);
      result.cleared.push(path.relative(rootDir, fullPath));
    } catch (e) {
      result.errors.push(
        `unlink ${path.relative(rootDir, fullPath)}: ${(e as Error).message}`
      );
    }
  }
}