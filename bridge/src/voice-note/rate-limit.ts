// ---------------------------------------------------------------------------
// VoiceNoteRateLimit — per-phone sliding-window counter.
//
// WHY: a single customer (or a bad actor spoofing one) could run up the
// Groq bill by sending dozens of voice notes. Capping per-phone per-hour
// bounds the worst case to MAX_VOICE_PER_HOUR Groq calls per customer per
// rolling 60 minutes.
//
// PROCESS-LOCAL: state is in-memory Map. Same caveats as MessageDedupe —
// restart resets, no cross-replica sharing. Acceptable for single bridge.
//
// PRUNING: on every allow() call we prune expired timestamps for the
// caller. Pruning is O(k) per call where k = number of timestamps kept;
// with default cap=5 this is trivial. If we ever raise the cap to hundreds,
// switch to lazy background pruning.
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000;

export class VoiceNoteRateLimit {
  private readonly byPhone: Map<string, number[]> = new Map();
  private readonly windowMs: number;
  private readonly cap: number;

  constructor(opts?: { windowMs?: number; cap?: number }) {
    this.windowMs = opts?.windowMs ?? ONE_HOUR_MS;
    this.cap = opts?.cap ?? (Number(process.env.MAX_VOICE_PER_HOUR) || 5);
  }

  /**
   * Atomic check-and-record. Returns `true` if the call is allowed (under
   * cap), `false` if the caller should be rate-limited.
   */
  allow(phone: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.byPhone.get(phone) ?? [];

    // Prune expired entries from the front. Timestamps are appended in
    // chronological order, so expired ones cluster at the start.
    let firstFresh = 0;
    while (firstFresh < timestamps.length && timestamps[firstFresh] <= cutoff) {
      firstFresh++;
    }
    const fresh =
      firstFresh > 0 ? timestamps.slice(firstFresh) : timestamps;

    if (fresh.length >= this.cap) {
      // Persist pruned state so the next call doesn't re-prune the same
      // expired entries, but don't record this rejected attempt.
      this.byPhone.set(phone, fresh);
      return false;
    }

    fresh.push(now);
    this.byPhone.set(phone, fresh);
    return true;
  }

  /** Current count within window for a phone — for tests + observability. */
  count(phone: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.byPhone.get(phone) ?? [];
    return timestamps.filter((t) => t > cutoff).length;
  }

  /** Reset all state. For tests only. */
  clear(): void {
    this.byPhone.clear();
  }
}