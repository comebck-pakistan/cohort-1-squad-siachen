-- =====================================================================
-- 2026-08-07 v3 — Neutralize 4 polluted customers rows
--
-- v1 hit customers_phone_key (couldn't set multiple rows to '').
-- v2 hit idx_one_active_conversation (reattaching multiple active
--   conversations to the same placeholder customer violated the
--   partial unique index WHERE status='active').
-- v3 resolves the conversations FIRST, then reassigns customer_id.
--   Once status='resolved', the partial index no longer applies
--   and there's no collision.
--
-- Strategy:
--   1. Create the placeholder customer row.
--   2. Mark all the conversations of the 4 polluted customers as
--      'resolved' (this gets them OUT OF the partial unique
--      index's WHERE clause).
--   3. Reattach those resolved conversations to the placeholder.
--   4. Write synthetic resolved escalation_events for history.
--   5. Delete the 4 polluted customer rows.
--
-- Why this is safe
-- ----------------
-- - The 4 polluted customer UUIDs are pinned by exact match — no
--   risk of accidentally touching a real customer.
-- - No real customer rows touched.
-- - No real conversations deleted — they get reassigned to the
--   placeholder, status='resolved', messages intact.
-- - Wrapped in a single transaction.
-- - Re-running is idempotent: placeholder upsert is safe,
--   escalation_events insert is guarded by NOT EXISTS.
-- =====================================================================

begin;

-- Step 1: create the placeholder customer row if it doesn't exist.
-- Sentinel phone 'POLLUTED_PLACEHOLDER' is unique-by-construction.
insert into public.customers (phone, name)
values ('POLLUTED_PLACEHOLDER', 'Archived test data')
on conflict (phone) do nothing;

-- Step 2: mark the 4 polluted customers' conversations as resolved
-- BEFORE we touch customer_id. This gets them out of the partial
-- unique index's WHERE clause so the reattach in Step 3 is safe.
update public.conversations c
set status = 'resolved'
where c.customer_id in (
  '979bcead-5f6a-49bb-a26b-5263060ca80b',
  'ed1853c2-7106-43b5-b393-cd8389ab23ca',
  'f1c1839e-4388-4efb-891b-6a5a99a04ae0',
  'f74538ed-644e-41c8-aeaa-51a4cbe40687'
)
and c.status in ('active', 'human_takeover', 'escalated');

-- Step 3: now safe to reassign customer_id (no active-conversation
-- uniqueness constraint applies).
update public.conversations c
set customer_id = (select id from public.customers where phone = 'POLLUTED_PLACEHOLDER')
where c.customer_id in (
  '979bcead-5f6a-49bb-a26b-5263060ca80b',
  'ed1853c2-7106-43b5-b393-cd8389ab23ca',
  'f1c1839e-4388-4efb-891b-6a5a99a04ae0',
  'f74538ed-644e-41c8-aeaa-51a4cbe40687'
);

-- Step 4: synthetic resolved escalation_events for history view.
-- Guarded by NOT EXISTS so re-running is safe.
insert into public.escalation_events (conversation_id, reason, resolved, resolved_at)
select c.id, 'customer_complaint', true, now()
from public.conversations c
join public.customers cust on cust.id = c.customer_id
where cust.phone = 'POLLUTED_PLACEHOLDER'
  and not exists (
    select 1 from public.escalation_events e
    where e.conversation_id = c.id
      and e.reason = 'customer_complaint'
  );

-- Step 5: NOW delete the 4 polluted customer rows. Conversations
-- have been resolved AND reassigned in Steps 2-3, so no FK
-- cascades will fire.
delete from public.customers
where id in (
  '979bcead-5f6a-49bb-a26b-5263060ca80b',
  'ed1853c2-7106-43b5-b393-cd8389ab23ca',
  'f1c1839e-4388-4efb-891b-6a5a99a04ae0',
  'f74538ed-644e-41c8-aeaa-51a4cbe40687'
);

commit;

-- =====================================================================
-- Verification (run AFTER the transaction commits):
--
--   -- The 4 polluted rows should be gone:
--   select count(*) from public.customers
--   where id in (
--     '979bcead-5f6a-49bb-a26b-5263060ca80b',
--     'ed1853c2-7106-43b5-b393-cd8389ab23ca',
--     'f1c1839e-4388-4efb-891b-6a5a99a04ae0',
--     'f74538ed-644e-41c8-aeaa-51a4cbe40687'
--   );
--   -- Expected: 0
--
--   -- The placeholder row exists:
--   select id, phone, name from public.customers
--   where phone = 'POLLUTED_PLACEHOLDER';
--   -- Expected: 1 row
--
--   -- Conversations reassigned + resolved:
--   select c.id, c.status, cust.phone
--   from conversations c
--   join customers cust on cust.id = c.customer_id
--   where cust.phone = 'POLLUTED_PLACEHOLDER';
--   -- Expected: all rows have status='resolved'
-- =====================================================================