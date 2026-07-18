-- =====================================================================
-- SalonIQ Database Schema (Supabase / PostgreSQL)
-- =====================================================================
-- Design notes:
-- 1. Named "business" instead of "salon" throughout so the platform can
--    scale to barbershops, clinics, spas, etc. later without a schema
--    rewrite (per mentor's scalability feedback).
-- 2. Capacity is NEVER stored as a fixed number. It's calculated at
--    query time from staff availability + hours + service duration +
--    existing appointments + breaks. This is what stops the bot from
--    overbooking.
-- 3. Edge case rules are split into "hard" (code-enforced, checked
--    before any booking action) and "soft" (prompt-injected guidance
--    for the LLM). Hard rules can also be platform-level (business_id
--    is NULL) so a salon owner can't disable a platform safety rule.
-- 4. All primary keys are UUIDs (Supabase convention, works well with
--    Row Level Security policies keyed on auth.uid()).
--
-- CHANGELOG (this revision):
-- - get_available_slots() rewritten. The original version matched ONE
--   qualified+available staff member per slot, which is correct for
--   services.staff_required = 1 but silently ignores staff_required > 1
--   (e.g. "Full Bridal Makeup" needing 2 staff). A slot with only 1 of
--   2 needed stylists free would have been returned as bookable. The
--   new version groups candidate slots and only returns a slot if at
--   least `staff_required` distinct qualified/available staff overlap
--   it, returning their ids as an array.
--   ⚠ BREAKING CHANGE: return shape changed from one row per
--   (slot, staff_id) to one row per slot with `available_staff_ids
--   uuid[]`. Any Edge Function or bot logic calling this function needs
--   to be updated to read the array instead of a single staff_id.
-- =====================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- =====================================================================
-- ENUMS
-- =====================================================================

create type user_role as enum ('superadmin', 'business_owner', 'staff');
create type business_tier as enum ('basic', 'pro', 'business');
create type billing_state as enum ('active', 'grace_period', 'suspended');
create type appointment_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type conversation_status as enum ('active', 'escalated', 'resolved');
create type message_sender as enum ('customer', 'agent', 'owner');
create type staff_day_status as enum ('available', 'off', 'sick');
create type rule_type as enum ('hard', 'soft');
create type holiday_reason as enum ('public_holiday', 'event', 'maintenance', 'emergency', 'other');
create type weekday as enum ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat');

-- =====================================================================
-- USERS & PROFILES
-- =====================================================================
-- Supabase auth.users handles login/auth itself. This table extends
-- it with app-specific role + business linkage.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'business_owner',
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- BUSINESSES (formerly "salons")
-- =====================================================================

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  business_type text not null default 'salon', -- 'salon','barbershop','clinic','spa', etc.
  city text,
  timezone text not null default 'Asia/Karachi',

  -- WhatsApp / infra credentials — superadmin-managed, owner should
  -- never see or edit these directly from the dashboard.
  whatsapp_number text,
  phone_number_id text,
  access_token text,

  tier business_tier not null default 'basic',
  billing_state billing_state not null default 'active',
  billing_grace_expires_at timestamptz, -- when grace period ends
  agent_active boolean not null default true, -- kill switch (superadmin OR owner pause)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_businesses_owner on public.businesses(owner_id);
create index idx_businesses_tier on public.businesses(tier);
create index idx_businesses_billing_state on public.businesses(billing_state);

-- =====================================================================
-- BUSINESS HOURS (custom per-day open/close, handles weekly off days)
-- =====================================================================

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  day_of_week weekday not null,
  is_open boolean not null default true,
  open_time time, -- null if is_open = false
  close_time time,
  unique (business_id, day_of_week)
);

-- =====================================================================
-- HOLIDAYS / BLACKOUT DATES
-- =====================================================================
-- Ad-hoc closures: public holidays, events, maintenance, emergencies.
-- Owner adds these via the Calendar page.

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null,
  reason holiday_reason not null default 'other',
  note text,
  created_at timestamptz not null default now(),
  unique (business_id, date)
);

create index idx_holidays_business_date on public.holidays(business_id, date);

-- =====================================================================
-- SERVICES
-- =====================================================================

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  staff_required int not null default 1 check (staff_required >= 1),
  price numeric(10,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_services_business on public.services(business_id);

-- =====================================================================
-- STAFF
-- =====================================================================

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,
  is_active boolean not null default true, -- soft-deleted staff = false
  created_at timestamptz not null default now()
);

create index idx_staff_business on public.staff(business_id);

-- Which services a staff member can perform (many-to-many)
create table public.staff_skills (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (staff_id, service_id)
);

-- Daily availability override (handles "stylist called in sick today")
create table public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  date date not null,
  status staff_day_status not null default 'available',
  start_time time, -- optional override of normal hours for that day
  end_time time,
  created_at timestamptz not null default now(),
  unique (staff_id, date)
);

create index idx_staff_availability_staff_date on public.staff_availability(staff_id, date);

-- Breaks (lunch, prayer, etc.) — subtracted from capacity calculation
create table public.staff_breaks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  reason text
);

create index idx_staff_breaks_staff_date on public.staff_breaks(staff_id, date);

-- =====================================================================
-- CUSTOMERS
-- =====================================================================
-- Lightweight — a customer is identified by phone number and can
-- interact with multiple businesses on the platform.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- APPOINTMENTS
-- =====================================================================

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  service_id uuid not null references public.services(id) on delete restrict,

  start_time timestamptz not null,
  end_time timestamptz not null,
  status appointment_status not null default 'pending',
  source text not null default 'whatsapp_bot', -- 'whatsapp_bot','owner_manual','walk_in'

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_appointments_business_time on public.appointments(business_id, start_time);
create index idx_appointments_staff_time on public.appointments(staff_id, start_time);
create index idx_appointments_customer on public.appointments(customer_id);

-- Prevents true double-booking at the database level: no two
-- appointments for the same staff member can overlap in time.
-- Requires the btree_gist extension for the exclusion constraint.
create extension if not exists "btree_gist";

alter table public.appointments
  add constraint no_overlapping_staff_appointments
  exclude using gist (
    staff_id with =,
    tstzrange(start_time, end_time) with &&
  )
  where (staff_id is not null and status in ('pending', 'confirmed'));

-- =====================================================================
-- CONVERSATIONS & MESSAGES (WhatsApp chat log)
-- =====================================================================

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status conversation_status not null default 'active',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_conversations_business on public.conversations(business_id, status);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_type message_sender not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on public.messages(conversation_id, created_at);

-- =====================================================================
-- EDGE CASE RULES
-- =====================================================================
-- business_id = NULL means it's a platform-level rule (superadmin-set,
-- applies to every business, cannot be disabled by an owner).
-- Hard rules are checked in code before the agent takes an action.
-- Soft rules are injected into the LLM's system prompt as guidance.

create table public.edge_case_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade, -- NULL = platform-level
  rule_type rule_type not null default 'soft',
  rule_text text not null,
  trigger_keywords text[], -- used for hard rules (keyword/regex matching)
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_edge_case_rules_business on public.edge_case_rules(business_id);

-- =====================================================================
-- ESCALATION EVENTS
-- =====================================================================
-- Logged every time a hard rule fires or the agent has low confidence
-- and defers to the owner instead of guessing.

create table public.escalation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  triggered_rule_id uuid references public.edge_case_rules(id) on delete set null,
  reason text not null, -- e.g. 'hard_rule_match', 'low_confidence', 'customer_request'
  ai_draft_response text, -- what the AI would have said, for owner review
  resolved boolean not null default false,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_escalation_events_conversation on public.escalation_events(conversation_id);
create index idx_escalation_events_resolved on public.escalation_events(resolved);

-- =====================================================================
-- PROMOTIONS
-- =====================================================================

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  text text not null,
  start_date date,
  end_date date, -- null = ongoing until manually deactivated
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_promotions_business_active on public.promotions(business_id, is_active);

-- =====================================================================
-- SUBSCRIPTIONS / BILLING (simple version — extend later with a real
-- payments provider's webhook data if needed)
-- =====================================================================

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  tier business_tier not null,
  monthly_price numeric(10,2) not null,
  started_at timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_subscriptions_business on public.subscriptions(business_id);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
-- Enabled on every table that holds business-scoped data. Policies
-- below are a starting point — 03_rls_policies.sql replaces/completes
-- these with the full, tested policy set. Left here so the schema is
-- self-contained even if run standalone.

alter table public.businesses enable row level security;
alter table public.business_hours enable row level security;
alter table public.holidays enable row level security;
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.staff_skills enable row level security;
alter table public.staff_availability enable row level security;
alter table public.staff_breaks enable row level security;
alter table public.appointments enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.edge_case_rules enable row level security;
alter table public.escalation_events enable row level security;
alter table public.promotions enable row level security;
alter table public.subscriptions enable row level security;

-- Superadmins can see/do everything.
create policy "Superadmins full access - businesses"
  on public.businesses for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin'));

-- Business owners can only access their own business's data.
create policy "Owners manage their own business"
  on public.businesses for all
  using (owner_id = auth.uid());

-- Example pattern for child tables (repeat similarly for staff,
-- services, appointments, etc. — all scoped through business_id):
create policy "Owners manage their own business hours"
  on public.business_hours for all
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

create policy "Superadmins full access - business hours"
  on public.business_hours for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin'));

-- NOTE: 03_rls_policies.sql drops and replaces the two policies above
-- with the complete, business-id-traversal-based policy set for every
-- table listed here. Nothing further to add in this file.

-- =====================================================================
-- HELPER FUNCTION: available slots for a service on a given date
-- =====================================================================
-- Returns capacity-aware availability by checking:
--   business hours -> holidays -> staff availability -> staff skill
--   match -> existing appointments -> breaks -> simultaneous headcount
-- This is what the WhatsApp bot should call before offering a slot,
-- so it never overbooks — and now correctly handles services that
-- require more than one staff member at once (e.g. Full Bridal Makeup).
--
-- Returns one row per bookable slot, with `available_staff_ids` holding
-- every qualified+free staff member for that slot (guaranteed to be at
-- least `services.staff_required` long). The caller picks which staff
-- id(s) to actually assign at confirmation time — the exclusion
-- constraint on `appointments` still protects against a race condition
-- double-booking any individual staff member.

create or replace function public.get_available_slots(
  p_business_id uuid,
  p_service_id uuid,
  p_date date
)
returns table (slot_start timestamptz, slot_end timestamptz, available_staff_ids uuid[])
language plpgsql
as $$
declare
  v_duration int;
  v_staff_required int;
  v_day weekday;
  v_open time;
  v_close time;
  v_is_open boolean;
  v_is_holiday boolean;
begin
  select duration_minutes, staff_required into v_duration, v_staff_required
  from public.services where id = p_service_id;

  v_day := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_date)::int + 1]::weekday;

  select is_open, open_time, close_time into v_is_open, v_open, v_close
  from public.business_hours
  where business_id = p_business_id and day_of_week = v_day;

  select exists(
    select 1 from public.holidays where business_id = p_business_id and date = p_date
  ) into v_is_holiday;

  if not v_is_open or v_is_holiday then
    return; -- no slots at all
  end if;

  return query
  with candidate_staff_slots as (
    -- Every (slot, qualified+free staff member) pair, same filtering
    -- logic as before: skill match, marked available that day, no
    -- overlapping appointment, no overlapping break.
    select
      (p_date + s.slot_time)::timestamptz as slot_start,
      (p_date + s.slot_time + (v_duration || ' minutes')::interval)::timestamptz as slot_end,
      st.id as staff_id
    from public.staff st
    join public.staff_skills sk on sk.staff_id = st.id and sk.service_id = p_service_id
    join lateral (
      -- generate_series has no overload for the `time` type, so we
      -- generate over timestamp (anchored to an arbitrary date) and
      -- cast back to time.
      select generate_series(
        ('2000-01-01'::date + v_open)::timestamp,
        ('2000-01-01'::date + v_close)::timestamp - (v_duration || ' minutes')::interval,
        (v_duration || ' minutes')::interval
      )::time as slot_time
    ) s on true
    left join public.staff_availability sa on sa.staff_id = st.id and sa.date = p_date
    where st.business_id = p_business_id
      and st.is_active = true
      and coalesce(sa.status, 'available') = 'available'
      -- exclude slots that overlap an existing appointment for this staff member
      and not exists (
        select 1 from public.appointments ap
        where ap.staff_id = st.id
          and ap.status in ('pending', 'confirmed')
          and tstzrange(ap.start_time, ap.end_time) && tstzrange((p_date + s.slot_time)::timestamptz, (p_date + s.slot_time + (v_duration || ' minutes')::interval)::timestamptz)
      )
      -- exclude slots that overlap a break
      and not exists (
        select 1 from public.staff_breaks b
        where b.staff_id = st.id and b.date = p_date
          and (s.slot_time, s.slot_time + (v_duration || ' minutes')::interval) overlaps (b.start_time, b.end_time)
      )
  )
  -- Collapse to one row per slot, only keeping slots where enough
  -- distinct staff are simultaneously free to cover staff_required.
  select
    css.slot_start,
    css.slot_end,
    array_agg(css.staff_id) as available_staff_ids
  from candidate_staff_slots css
  group by css.slot_start, css.slot_end
  having count(css.staff_id) >= v_staff_required;
end;
$$;