# Halo — Supabase Changelog

A running log of every schema change applied to the Halo Supabase project.
Squad-wide visibility — so we don't lose track of what's live.

Format: one entry per migration, reverse-chronological. Newest first.

---

## 2026-07-22 — Vara

**Branch**: `vara/backend-whatsapp-api-integration`
**PR**: TBD
**Goal**: Scalability via structured conversation state — no verbatim message storage going forward. Confirms multi-tenant for real.

### Migrations applied

#### `database/schema/12_conversation_state.sql`
- New table `conversation_state` — one row per conversation capturing:
  intent, service interest, preferred date/time, customer name and phone,
  last customer line, last agent line, status, outcome.
- Row Level Security **enabled** on `conversation_state`. Backend uses
  service role which bypasses RLS, so webhook and demo routes can
  read/write. Future owner dashboard (anon/authenticated) will need
  policies added before it can read.
- Index `idx_conv_state_business` on `(business_id, updated_at DESC)` for
  fast tenant-scoped reads.
- New columns on existing `conversations` table: `resolved_at`,
  `resolution_reason`.
- Partial index `idx_conv_resolved` on `resolved_at WHERE NOT NULL` for
  fast lifecycle queries.

#### `database/schema/11_conversation_unique_active.sql`
- Partial unique index `(business_id, customer_id) WHERE status = 'active'`
  on `conversations`. Prevents two parallel "active" conversations per
  (business, customer). Race protection at the DB level.

### Behavioral change (effective with this PR's code edits)
- Bot no longer reads/writes raw customer messages to the `messages`
  table going forward.
- Bot reads/writes structured `conversation_state` instead.
- Existing rows in `messages` from before 2026-07-22 are frozen (not
  deleted, just not extended).

### Why
- Each conversation was producing 30–60 verbatim rows ≈ 50KB per
  conversation. Long-term unscalable.
- WhatsApp already retains raw conversation on Meta's servers, so
  Halo doesn't need to be the audit log.
- Structured state gives the bot, the owner view, and analytics the
  same information with one row per conversation instead of dozens.

### Notes
- `database/schema/12_conversation_state.sql` was run twice in Supabase
  on 2026-07-22. Safe because every statement uses `IF NOT EXISTS` —
  second run was a no-op.
- `database/schema/11_conversation_unique_active.sql` was run once on
  2026-07-22.

### Open followups (Week 5+)
- Retention cron: archive `messages` rows older than 30 days for
  resolved conversations.
- RLS policies on `conversation_state` for owner-dashboard access.
- Per-salon WhatsApp credentials (task #36).
- Bookings table + `get_available_slots()` (task #34).

---
