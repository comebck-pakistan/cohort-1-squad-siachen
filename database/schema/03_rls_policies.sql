-- =====================================================================
-- SalonIQ — Complete RLS Policies
-- Covers every table in saloniq_schema.sql + v1.1 migration
-- Run this AFTER both schema files have been executed
-- =====================================================================
--
-- THREE ACTORS in this system:
--
-- 1. SUPERADMIN   — full access to everything, every table
-- 2. BUSINESS OWNER — scoped to their own business only
-- 3. WHATSAPP BOT — uses Supabase SERVICE ROLE key, which bypasses
--                   RLS entirely. No policies needed for the bot.
--                   NEVER expose the service role key to the frontend.
--
-- HELPER: we use a helper function so the superadmin check doesn't
-- do a subquery on every single row evaluation — it checks the role
-- once and caches it for the duration of the request.
--
-- CHANGELOG (this revision):
-- - Removed section 22 (TIER LIMITS policies). This file and
--   07_tier_limits.sql both created a policy named
--   "Superadmins manage tier limits" on public.tier_limits — whichever
--   file ran second would fail with a duplicate-policy-name error.
--   tier_limits policies now live only in 07_tier_limits.sql.
-- =====================================================================

create or replace function public.is_superadmin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin'
  );
$$;

-- =====================================================================
-- 1. PROFILES
-- =====================================================================
-- Users can read and update their own profile.
-- Superadmins can read all profiles (needed for admin dashboard).
-- No one can insert directly — Supabase Auth trigger handles that.
-- No one can delete profiles directly — cascade from auth.users.

alter table public.profiles enable row level security;

create policy "Users read own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "Users update own profile"
  on public.profiles for update
  using (id = auth.uid());

create policy "Superadmins read all profiles"
  on public.profiles for select
  using (public.is_superadmin());

create policy "Superadmins update all profiles"
  on public.profiles for update
  using (public.is_superadmin());

-- =====================================================================
-- 2. BUSINESSES
-- =====================================================================
-- Already partially defined in schema — rewriting here completely.
-- Drop the originals first if re-running this file.

drop policy if exists "Superadmins full access - businesses" on public.businesses;
drop policy if exists "Owners manage their own business" on public.businesses;

create policy "Owners read own business"
  on public.businesses for select
  using (owner_id = auth.uid());

create policy "Owners update own business"
  on public.businesses for update
  using (owner_id = auth.uid());

-- Owners cannot insert or delete businesses themselves —
-- only superadmin creates/removes businesses (via Add New Salon flow).
create policy "Superadmins full access - businesses"
  on public.businesses for all
  using (public.is_superadmin());

-- =====================================================================
-- 3. BUSINESS HOURS
-- =====================================================================

drop policy if exists "Owners manage their own business hours" on public.business_hours;
drop policy if exists "Superadmins full access - business hours" on public.business_hours;

create policy "Owners manage own business hours"
  on public.business_hours for all
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - business_hours"
  on public.business_hours for all
  using (public.is_superadmin());

-- =====================================================================
-- 4. HOLIDAYS
-- =====================================================================

create policy "Owners manage own holidays"
  on public.holidays for all
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - holidays"
  on public.holidays for all
  using (public.is_superadmin());

-- =====================================================================
-- 5. SERVICES
-- =====================================================================

create policy "Owners manage own services"
  on public.services for all
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - services"
  on public.services for all
  using (public.is_superadmin());

-- =====================================================================
-- 6. STAFF
-- =====================================================================

create policy "Owners manage own staff"
  on public.staff for all
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - staff"
  on public.staff for all
  using (public.is_superadmin());

-- =====================================================================
-- 7. STAFF SKILLS
-- =====================================================================
-- No direct business_id — traverse through staff

create policy "Owners manage own staff skills"
  on public.staff_skills for all
  using (
    staff_id in (
      select s.id from public.staff s
      join public.businesses b on b.id = s.business_id
      where b.owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - staff_skills"
  on public.staff_skills for all
  using (public.is_superadmin());

-- =====================================================================
-- 8. STAFF AVAILABILITY
-- =====================================================================
-- Traverse through staff -> businesses

create policy "Owners manage own staff availability"
  on public.staff_availability for all
  using (
    staff_id in (
      select s.id from public.staff s
      join public.businesses b on b.id = s.business_id
      where b.owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - staff_availability"
  on public.staff_availability for all
  using (public.is_superadmin());

-- =====================================================================
-- 9. STAFF BREAKS
-- =====================================================================
-- Traverse through staff -> businesses

create policy "Owners manage own staff breaks"
  on public.staff_breaks for all
  using (
    staff_id in (
      select s.id from public.staff s
      join public.businesses b on b.id = s.business_id
      where b.owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - staff_breaks"
  on public.staff_breaks for all
  using (public.is_superadmin());

-- =====================================================================
-- 10. CUSTOMERS
-- =====================================================================
-- Customers are platform-wide (no business_id on the table itself).
-- An owner should only see customers who have had appointments
-- or conversations with their business — not the entire customer list.
-- The WhatsApp bot (service role) creates/upserts customers freely.

alter table public.customers enable row level security;

create policy "Owners read customers who interacted with their business"
  on public.customers for select
  using (
    id in (
      select customer_id from public.appointments
      where business_id in (
        select id from public.businesses where owner_id = auth.uid()
      )
      union
      select customer_id from public.conversations
      where business_id in (
        select id from public.businesses where owner_id = auth.uid()
      )
    )
  );

-- Owners can update customer name/details for their own customers
create policy "Owners update their own customers"
  on public.customers for update
  using (
    id in (
      select customer_id from public.appointments
      where business_id in (
        select id from public.businesses where owner_id = auth.uid()
      )
    )
  );

create policy "Superadmins full access - customers"
  on public.customers for all
  using (public.is_superadmin());

-- =====================================================================
-- 11. APPOINTMENTS
-- =====================================================================

create policy "Owners manage own appointments"
  on public.appointments for all
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - appointments"
  on public.appointments for all
  using (public.is_superadmin());

-- =====================================================================
-- 12. CONVERSATIONS
-- =====================================================================

create policy "Owners manage own conversations"
  on public.conversations for all
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - conversations"
  on public.conversations for all
  using (public.is_superadmin());

-- =====================================================================
-- 13. MESSAGES
-- =====================================================================
-- Traverse through conversation_id -> conversations.business_id

create policy "Owners read own messages"
  on public.messages for select
  using (
    conversation_id in (
      select c.id from public.conversations c
      join public.businesses b on b.id = c.business_id
      where b.owner_id = auth.uid()
    )
  );

-- Owners can insert messages (when they manually reply from dashboard)
create policy "Owners insert messages in own conversations"
  on public.messages for insert
  with check (
    conversation_id in (
      select c.id from public.conversations c
      join public.businesses b on b.id = c.business_id
      where b.owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - messages"
  on public.messages for all
  using (public.is_superadmin());

-- =====================================================================
-- 14. EDGE CASE RULES
-- =====================================================================
-- Special case: business_id = NULL means platform-level rule.
-- Owners can READ platform-level rules (their agent uses them)
-- but cannot modify them — only superadmin can.
-- Owners can fully manage their OWN business-level rules.

create policy "Owners read own rules and platform rules"
  on public.edge_case_rules for select
  using (
    business_id is null  -- platform-level: readable by everyone
    or
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Owners insert own rules"
  on public.edge_case_rules for insert
  with check (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
    -- business_id must NOT be null (owners can't create platform rules)
    and business_id is not null
  );

create policy "Owners update own rules"
  on public.edge_case_rules for update
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
    and business_id is not null
  );

create policy "Owners delete own rules"
  on public.edge_case_rules for delete
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
    and business_id is not null
  );

create policy "Superadmins full access - edge_case_rules"
  on public.edge_case_rules for all
  using (public.is_superadmin());

-- =====================================================================
-- 15. ESCALATION EVENTS
-- =====================================================================
-- Traverse through conversation_id -> conversations.business_id

create policy "Owners read own escalations"
  on public.escalation_events for select
  using (
    conversation_id in (
      select c.id from public.conversations c
      join public.businesses b on b.id = c.business_id
      where b.owner_id = auth.uid()
    )
  );

-- Owners can mark escalations as resolved from their dashboard
create policy "Owners resolve own escalations"
  on public.escalation_events for update
  using (
    conversation_id in (
      select c.id from public.conversations c
      join public.businesses b on b.id = c.business_id
      where b.owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - escalation_events"
  on public.escalation_events for all
  using (public.is_superadmin());

-- =====================================================================
-- 16. PROMOTIONS
-- =====================================================================

create policy "Owners manage own promotions"
  on public.promotions for all
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - promotions"
  on public.promotions for all
  using (public.is_superadmin());

-- =====================================================================
-- 17. SUBSCRIPTIONS
-- =====================================================================
-- Owners can read their own subscription (to display plan info).
-- Only superadmin creates/modifies subscriptions.

create policy "Owners read own subscription"
  on public.subscriptions for select
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

create policy "Superadmins full access - subscriptions"
  on public.subscriptions for all
  using (public.is_superadmin());

-- =====================================================================
-- v1.1 TABLES
-- =====================================================================

-- =====================================================================
-- 18. REMINDERS
-- =====================================================================
-- Drop the partial policies from v1.1 and replace with complete set

drop policy if exists "Owners view their own reminders" on public.reminders;
drop policy if exists "Superadmins full access - reminders" on public.reminders;

create policy "Owners read own reminders"
  on public.reminders for select
  using (
    appointment_id in (
      select a.id from public.appointments a
      join public.businesses b on b.id = a.business_id
      where b.owner_id = auth.uid()
    )
  );

-- Owners cannot manually create/edit reminders — the bot and cron job
-- handle that via service role. Read-only for owners.

create policy "Superadmins full access - reminders"
  on public.reminders for all
  using (public.is_superadmin());

-- =====================================================================
-- 19. APPOINTMENT HISTORY
-- =====================================================================

create policy "Owners read own appointment history"
  on public.appointment_history for select
  using (
    appointment_id in (
      select a.id from public.appointments a
      join public.businesses b on b.id = a.business_id
      where b.owner_id = auth.uid()
    )
  );

-- History is immutable — no update/delete for owners.
-- Bot writes via service role. Superadmin has full access.

create policy "Superadmins full access - appointment_history"
  on public.appointment_history for all
  using (public.is_superadmin());

-- =====================================================================
-- 20. PAYMENTS
-- =====================================================================

drop policy if exists "Owners view their own payments" on public.payments;
drop policy if exists "Superadmins full access - payments" on public.payments;

create policy "Owners read own payments"
  on public.payments for select
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

-- Owners cannot create or edit payment records —
-- only superadmin or a payment gateway webhook (service role) does that.

create policy "Superadmins full access - payments"
  on public.payments for all
  using (public.is_superadmin());

-- =====================================================================
-- 21. AUDIT LOG
-- =====================================================================

drop policy if exists "Superadmins only - audit log" on public.audit_log;

-- No owner access at all. Superadmin only.
create policy "Superadmins only - audit_log"
  on public.audit_log for all
  using (public.is_superadmin());

-- =====================================================================
-- 22. TIER LIMITS
-- =====================================================================
-- Intentionally NOT defined here. `tier_limits` (table, RLS enable,
-- and both of its policies) is owned entirely by 07_tier_limits.sql —
-- that file already enables RLS and creates "Everyone can view tier
-- limits configuration" + "Superadmins manage tier limits". Duplicating
-- a same-named policy here would fail with a "policy already exists"
-- error the second time this ran into 07 (or vice versa, depending on
-- order). Keep tier_limits policy ownership in exactly one file.

-- =====================================================================
-- 23. USAGE COUNTERS
-- =====================================================================

create policy "Owners read own usage"
  on public.usage_counters for select
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

-- Owners cannot write usage counters — only the bot (service role)
-- increments these. Read-only for owners, full access for superadmin.

create policy "Superadmins full access - usage_counters"
  on public.usage_counters for all
  using (public.is_superadmin());

-- =====================================================================
-- IMPORTANT NOTE FOR YOUR TEAM
-- =====================================================================
-- Your WhatsApp bot backend should ALWAYS use the Supabase SERVICE ROLE
-- key (SUPABASE_SERVICE_ROLE_KEY in your .env), NOT the anon key.
-- Service role bypasses RLS entirely — the bot can read/write any row
-- it needs without being blocked by these policies.
--
-- Your frontend dashboards (owner panel, superadmin panel) should use
-- the SUPABASE_ANON_KEY — RLS kicks in automatically based on the
-- logged-in user's auth.uid() and role.
--
-- NEVER put the service role key in frontend code or a public repo.
-- =====================================================================