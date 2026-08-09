-- =====================================================================
-- 2026-08-07 — Backfill customers.name from conversation_state
--
-- Context
-- -------
-- The bot learns the customer's name from their messages and stores
-- it in conversation_state.customer_name (the structured-slot column
-- the LLM prompt reads). The human-readable display column
-- customers.name was never back-filled — which meant every customer
-- row kept showing the raw phone number as the display label even
-- after the bot learned the name.
--
-- Story 13/18 + this wave now write customers.name forward, but we
-- have rows from before that change where customers.name IS NULL
-- despite conversation_state.customer_name being populated.
--
-- What this script does
-- ---------------------
-- 1. For every customer where customers.name IS NULL or empty (''),
--    find the most-recent non-empty conversation_state.customer_name
--    associated with any of their conversations, and write it back.
-- 2. NEVER overwrites an existing non-empty customers.name — even
--    if the most-recent slot has a different value. Owner-edited or
--    previously-persisted names win. (Same guard the runtime helper
--    updateCustomerNameIfMissing() applies.)
-- 3. Idempotent — running it twice is a no-op the second time.
--
-- Safety
-- ------
-- - Runs inside a single transaction. Safe to re-run.
-- - Bypasses the customer's RLS UPDATE policy by running as the
--   migration role. Run with: psql ... -f this.sql
-- - Estimated rows touched in a pilot salon: tens, low hundreds.
--   For larger salons the window function is O(n log n) and should
--   still finish in seconds.
--
-- What this script does NOT do
-- ----------------------------
-- - It does NOT backfill LID-format "needs review" flags for
--   historical conversations. We can't reliably identify those rows
--   from the DB alone (the raw phone isn't stored; only the
--   normalized digits). New LID-format messages get flagged by
--   message-handler.ts going forward.
-- - It does NOT touch customers where name IS NOT NULL — they're
--   left alone.
-- =====================================================================

begin;

-- Step 1: collect the latest non-empty customer_name slot per customer
-- from their conversation_state rows. DISTINCT ON picks the most
-- recently updated row per customer.
with latest_slot as (
  select distinct on (cs.customer_id_for_state)
    cs.customer_id_for_state as customer_id,
    cs.customer_name as candidate_name
  from (
    -- conversation_state is keyed by conversation_id; we need
    -- customer_id which lives on conversations. Inline the join
    -- here so we can DISTINCT ON the customer_id cleanly.
    select
      c.customer_id as customer_id_for_state,
      cs.customer_name,
      cs.updated_at
    from public.conversation_state cs
    join public.conversations c on c.id = cs.conversation_id
    where cs.customer_name is not null
      and length(trim(cs.customer_name)) > 0
      -- Defensive: skip obvious placeholders that may have leaked
      -- into the slot. Matches the runtime guard in
      -- updateCustomerNameIfMissing() in backend/src/lib/db.ts.
      and lower(trim(cs.customer_name)) not in (
        'unknown', 'customer', '—', '-', 'n/a', 'null'
      )
      -- Defensive: skip phone-shaped strings (>= 8 digits)
      and length(regexp_replace(cs.customer_name, '[^0-9]', '', 'g')) < 8
    order by cs.customer_id_for_state, cs.updated_at desc
  ) cs
)

-- Step 2: only update customer rows that are currently empty.
-- Re-check the empty-condition inside the WHERE to make the UPDATE
-- race-safe if another process writes to customers.name concurrently.
update public.customers c
set name = ls.candidate_name
from latest_slot ls
where c.id = ls.customer_id
  and (c.name is null or length(trim(c.name)) = 0);

commit;

-- =====================================================================
-- Verification (run AFTER the transaction commits):
--
--   -- How many rows got a name back-filled?
--   select count(*) from public.customers
--   where name is not null and length(trim(name)) > 0;
--
--   -- Any rows still missing a name? (Expected: customers who never
--   -- sent a message that the bot could extract a name from.)
--   select id, phone, created_at from public.customers
--   where name is null or length(trim(name)) = 0
--   order by created_at desc
--   limit 20;
-- =====================================================================