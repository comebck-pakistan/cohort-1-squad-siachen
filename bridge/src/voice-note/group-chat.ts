// ---------------------------------------------------------------------------
// isGroupChat — bridge-level pre-check that mirrors backend's filter.
//
// WHY DUPLICATE: the backend filter at backend/src/lib/db.ts:isGroupChat is
// not importable from the bridge (separate package, no DB module sharing).
// Calling Groq Whisper on a group-chat voice note wastes ~$0.001 per note
// AND the backend would silently drop the transcript anyway. We pre-filter
// here to avoid both.
//
// DRIFT SAFETY: if backend/src/lib/db.ts:isGroupChat changes, this MUST be
// updated to match. Drift produces duplicate work (bridge drops here OR
// backend drops there) — never a correctness bug, just wasted Groq calls.
// The integration test at bridge/src/voice-note/__tests__/group-chat.test.ts
// pins both implementations to the same fixtures.
// ---------------------------------------------------------------------------

export function isGroupChat(rawFrom: string | null | undefined): boolean {
  if (!rawFrom) return false;
  // Case 1: explicit @g.us suffix
  if (rawFrom.includes('@g.us')) return true;
  // Case 2: 15-18 digit bare numeric with no separators — chat JID
  if (/^\d{15,18}$/.test(rawFrom)) return true;
  // Case 3: LID-format with @g.us suffix (rare but possible)
  if (/^\d+-\d+@g\.us$/.test(rawFrom)) return true;
  return false;
}