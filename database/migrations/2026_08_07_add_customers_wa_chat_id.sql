-- =====================================================================
-- 2026-08-07 — Add customers.wa_chat_id for outbound-send round-trip
--
-- Context
-- -------
-- whatsapp-web.js hands us customer identifiers in one of two shapes:
--   1. Normal     — "<digits>@c.us"   (e.g. "923001234567@c.us")
--   2. LID-format — "<digits>-<digits>" with no "@" suffix
--                    (e.g. "966541183544-1454589702")
--
-- Until now we only stored the normalized digits in customers.phone,
-- which works fine for inbound (the bot just needs to route the
-- message) but breaks outbound (the owner-reply path constructs
-- `${phone}@c.us` and WhatsApp rejects it with "No LID for user"
-- because the customer's actual identifier is in LID format).
--
-- This column stores the raw identifier exactly as whatsapp-web.js
-- gave it to us, so the owner-reply endpoint can hand it back
-- verbatim. Both shapes are valid WhatsApp chatIds and round-trip
-- cleanly.
--
-- Safety
-- ------
-- - Additive: nullable text column, no NOT NULL constraint, no
--   default. Existing rows get NULL — their next inbound message
--   backfills the column via upsertCustomerChatId() in
--   backend/src/lib/db.ts.
-- - Idempotent: uses IF NOT EXISTS so re-running is a no-op.
-- - No data loss: doesn't touch any existing column or row.
-- - Runs in milliseconds even on large customers tables — single
--   ALTER TABLE on an unindexed nullable column.
--
-- RLS
-- ---
-- customers already has row-level security policies (see
-- 03_rls_policies.sql). This new column is covered by the same
-- policies automatically — owners can read their own customers'
-- wa_chat_id; superadmins can read all.
--
-- Privacy note (separate from WhatsApp ToS)
-- -----------------------------------------
-- wa_chat_id is a routing identifier WhatsApp itself uses internally
-- to address messages. We already see it on every inbound webhook
-- payload; persisting it doesn't change what data we handle, just
-- where it lives. Storing it is consistent with how the existing
-- code already logs and processes the raw `from` field in pino
-- child loggers throughout the message-handler pipeline.
-- =====================================================================

alter table public.customers
  add column if not exists wa_chat_id text;

-- Optional: a partial index on customers where wa_chat_id is set,
-- so the owner-reply endpoint's per-row lookup stays O(1) as the
-- table grows. Cheap to maintain because most customers will have
-- it set within one inbound message of the migration rolling out.
create index if not exists idx_customers_wa_chat_id
  on public.customers (wa_chat_id)
  where wa_chat_id is not null;

-- =====================================================================
-- Verification (run AFTER the migration commits):
--
--   -- Column exists and is nullable?
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_name = 'customers' and column_name = 'wa_chat_id';
--
--   -- How many customers already have a wa_chat_id?
--   select count(*) as filled, count(*) filter (where wa_chat_id is null) as not_filled
--   from public.customers;
--
--   -- The next inbound message from any NULL customer will
--   -- backfill the column via upsertCustomerChatId(). After a
--   -- day of normal traffic the not_filled count should be 0
--   -- for any customer who's messaged.
-- =====================================================================