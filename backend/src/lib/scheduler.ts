// ---------------------------------------------------------------------------
// Tiny in-process scheduler — Wave 7 (Phase 4).
//
// Replaces ad-hoc setInterval() calls with a small registry. Each registered
// job runs immediately on registration (so a freshly-booted backend doesn't
// wait for the first interval tick), then on every `intervalMs` thereafter.
//
// Why not `node-cron` / `bull` / `agenda`?
//   - Story 14 (appointment-reminder cron) is the next consumer of this
//     pattern. We don't need cron-syntax yet — just "every N minutes".
//   - The codebase has no Redis dependency, and adding one for two jobs is
//     overkill.
//   - A 30-line registry + `.unref()` handles is enough. Story 14 can move
//     to a heavier system later if cross-process coordination becomes real.
//
// `.unref()` is critical: without it, an active interval keeps the Node
// event loop alive forever, blocking graceful shutdown. With it, the timer
// doesn't count toward the process's liveness — `process.exit(0)` and the
// shutdown timeout in `index.ts` will both work cleanly.
// ---------------------------------------------------------------------------

interface RegisteredJob {
  name: string;
  intervalMs: number;
  handle: NodeJS.Timeout;
}

const jobs: RegisteredJob[] = [];

export function registerJob(
  name: string,
  fn: () => Promise<void>,
  intervalMs: number,
): void {
  if (jobs.some((j) => j.name === name)) {
    // Idempotency guard — prevents accidental double-registration if a job
    // module gets imported twice (HMR, test runs, etc).
    return;
  }
  const tick = async () => {
    try {
      await fn();
    } catch (e) {
      // Job-specific logging happens inside `fn`. We swallow here so a
      // thrown error in one job doesn't kill the whole registry — the
      // next interval tick still runs.
      // eslint-disable-next-line no-console
      console.error(`[scheduler] job '${name}' threw:`, e);
    }
  };
  // Fire once immediately so a freshly-booted backend doesn't wait
  // `intervalMs` for the first run.
  void tick();
  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  // Don't pin the event loop — graceful shutdown can still complete.
  handle.unref();
  jobs.push({ name, intervalMs, handle });
}

export function stopAllJobs(): void {
  for (const j of jobs) clearInterval(j.handle);
  jobs.length = 0;
}

/** Test/inspection helper. Returns a snapshot of currently registered jobs. */
export function listJobs(): Array<{ name: string; intervalMs: number }> {
  return jobs.map(({ name, intervalMs }) => ({ name, intervalMs }));
}
