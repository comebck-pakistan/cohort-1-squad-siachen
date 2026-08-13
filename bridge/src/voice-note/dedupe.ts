// ---------------------------------------------------------------------------
// MessageDedupe — bridge-level LRU Set<string> on WhatsApp message ids.
//
// WHY: whatsapp-web.js occasionally emits the same 'message' event twice
// (network redelivery, library race, sender-side app restart). Each emission
// would otherwise trigger a fresh Groq transcription. With dedupe, the second
// emission is dropped before any network call.
//
// PROCESS-LOCAL: state lives in this Set only. A bridge restart resets it,
// and two bridge replicas wouldn't share it. Acceptable for single-replica
// deployments (matches how the rest of the bridge state is held). Move to
// Redis-backed dedupe if/when we horizontally scale.
//
// LRU EVICTION: Set preserves insertion order. When we exceed the cap, the
// oldest entry is at the front; delete + re-add to move to the back. This
// keeps the most recent N ids and quietly drops older ones.
// ---------------------------------------------------------------------------

export class MessageDedupe {
  private readonly seen: Set<string>;
  private readonly capacity: number;

  constructor(capacity = 1000) {
    this.seen = new Set();
    this.capacity = capacity;
  }

  /**
   * Atomic check-and-insert. Returns `true` if `id` was already present
   * (i.e. caller should treat as a duplicate and drop), `false` if it was
   * newly recorded (caller should process it).
   */
  seenBefore(id: string): boolean {
    if (this.seen.has(id)) {
      // Move to back — but Sets don't have a direct move API. Delete +
      // re-add is the canonical pattern; insertion order reflects the most
      // recent observation, which is what we want for LRU semantics.
      this.seen.delete(id);
      this.seen.add(id);
      return true;
    }
    this.seen.add(id);
    if (this.seen.size > this.capacity) {
      // Evict oldest (first-inserted). Set iteration is insertion-order.
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return false;
  }

  /** Current size — for tests + observability. */
  size(): number {
    return this.seen.size;
  }

  /** Reset all state. For tests only. */
  clear(): void {
    this.seen.clear();
  }
}