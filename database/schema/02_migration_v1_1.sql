-- =====================================================================
-- SalonIQ Schema — v1.1 Migration
-- Adds: reminders, reschedule history, payments, audit log,
--       usage tracking, and dashboard aggregation views.
-- Run this AFTER 01_schema.sql
--
-- CHANGELOG (this revision):
-- - Removed the `tier_limits` table + seed data that used to live in
--   section 5 of this file. It was being redefined again (with a
--   different, incompatible column set) in 07_tier_limits.sql. Since
--   `07` ran second and used `CREATE TABLE IF NOT EXISTS`, Postgres
--   silently skipped creating its extra columns (max_staff_members,
--   allow_payments, allow_reminders, allow_human_handoff, ...) because
--   the table already existed from THIS file — and then `07`'s INSERT
--   referenced those missing columns and errored out.
--   `tier_limits` now has exactly one definition, in 07_tier_limits.sql.
--   This file keeps `usage_counters`, which tracks consumption against
--   whatever `tier_limits` defines, and isn't tier-shape-dependent.
-- =====================================================================

-- =====================================================================
-- 1. REMINDERS
-- =====================================================================
-- One row per reminder attempt, tied to a specific appointment.
-- Lets you answer "was the reminder for appointment X actually sent,
-- and when" instead of trusting application logic alone.

create type reminder_status as enum ('scheduled', 'sent', 'failed');

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  send_at timestamptz not null,       -- when it's supposed to go out
  status reminder_status not null default 'scheduled',
  sent_at timestamptz,                -- actually sent timestamp (null until sent)
  failure_reason text,                -- populated if status = 'failed'
  created_at timestamptz not null default now()
);

create index idx_reminders_appointment on public.reminders(appointment_id);
create index idx_reminders_pending on public.reminders(send_at) where status = 'scheduled';

-- =====================================================================
-- 2. RESCHEDULE HISTORY
-- =====================================================================
-- Appointments table still holds the CURRENT state (one row = current
-- booking). This table logs every change as an immutable audit trail,
-- so "what did this appointment used to be" is answerable.

create type appointment_change_type as enum ('rescheduled', 'cancelled', 'staff_reassigned');

create table public.appointment_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  change_type appointment_change_type not null,

  -- snapshot of the relevant fields BEFORE the change
  previous_start_time timestamptz,
  previous_end_time timestamptz,
  previous_staff_id uuid references public.staff(id),

  changed_by uuid references public.profiles(id), -- null if changed by the bot itself
  changed_by_type text not null default 'customer', -- 'customer','owner','bot','superadmin'
  reason text,

  created_at timestamptz not null default now()
);

create index idx_appointment_history_appointment on public.appointment_history(appointment_id);

-- =====================================================================
-- 3. PAYMENTS / INVOICES
-- =====================================================================
-- Actual transaction log against a subscription. Feeds the Superadmin
-- "Current Monthly Revenue" stat and drives grace_period -> suspended
-- transitions (a failed/missed payment triggers the state change,
-- rather than that being inferred from nothing).

create type payment_status as enum ('paid', 'pending', 'failed', 'refunded');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,

  amount numeric(10,2) not null,
  status payment_status not null default 'pending',
  billing_period_start date not null,
  billing_period_end date not null,

  payment_method text,          -- 'card','bank_transfer','manual', etc.
  external_reference text,      -- id from payment gateway, if/when integrated
  paid_at timestamptz,

  created_at timestamptz not null default now()
);

create index idx_payments_business on public.payments(business_id, status);
create index idx_payments_period on public.payments(billing_period_start, billing_period_end);

-- =====================================================================
-- 4. AUDIT LOG
-- =====================================================================
-- Records platform-level actions taken by superadmins (or any
-- privileged action worth tracking). Generic action/target pattern
-- so it doesn't need a new table every time a new admin action ships.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),      -- who did it
  action text not null,                                -- e.g. 'deactivate_agent', 'suspend_billing', 'edit_platform_rule'
  target_table text not null,                          -- e.g. 'businesses'
  target_id uuid not null,                             -- id of the row affected
  metadata jsonb,                                       -- free-form context, e.g. {"previous_state": "active", "new_state": "suspended"}
  created_at timestamptz not null default now()
);

create index idx_audit_log_actor on public.audit_log(actor_id);
create index idx_audit_log_target on public.audit_log(target_table, target_id);

-- =====================================================================
-- 5. USAGE TRACKING
-- =====================================================================
-- Rolling usage counter per business per calendar month. Incremented
-- by application logic (or a trigger) whenever an appointment/message
-- is created; checked before the bot confirms a new booking, against
-- whatever limits `public.tier_limits` (defined in 07) specifies for
-- that business's tier.

create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  period_start date not null, -- first day of the billing month
  appointments_count int not null default 0,
  messages_count int not null default 0,
  unique (business_id, period_start)
);

create index idx_usage_counters_business_period on public.usage_counters(business_id, period_start);

-- =====================================================================
-- 6. DASHBOARD AGGREGATION VIEWS
-- =====================================================================
-- Read-only views the dashboards query directly instead of running
-- ad-hoc COUNT()s scattered across the frontend. At larger scale these
-- can be swapped for materialized views refreshed on a schedule
-- without changing anything the frontend calls.

-- Salon Owner Overview page stats
create or replace view public.business_daily_stats as
select
  c.business_id,
  count(*) filter (where m.created_at::date = current_date and m.sender_type = 'agent') as messages_handled_today,
  count(*) filter (where a.created_at::date = current_date and a.status in ('pending','confirmed')) as bookings_made_today,
  count(*) filter (where e.created_at::date = current_date and e.resolved = false) as escalated_to_you_today
from public.conversations c
left join public.messages m on m.conversation_id = c.id
left join public.appointments a on a.business_id = c.business_id
left join public.escalation_events e on e.conversation_id = c.id
group by c.business_id;

-- Salon Owner "Customers Served This Month" stat
create or replace view public.business_monthly_customers as
select
  business_id,
  count(distinct customer_id) as customers_served_this_month
from public.appointments
where start_time >= date_trunc('month', now())
group by business_id;

-- Superadmin platform-wide stats (Total Messages Delivered, Revenue, etc.)
create or replace view public.platform_stats as
select
  (select count(*) from public.messages where sender_type = 'agent') as total_messages_delivered,
  (select coalesce(sum(amount), 0) from public.payments
     where status = 'paid' and paid_at >= date_trunc('month', now())) as current_monthly_revenue,
  (select count(*) from public.escalation_events where resolved = false) as pending_edge_cases,
  (select count(distinct city) from public.businesses where city is not null) as active_cities;

-- =====================================================================
-- RLS for new tables (owner-scoped + superadmin-full-access pattern,
-- same as the base schema)
-- =====================================================================

alter table public.reminders enable row level security;
alter table public.appointment_history enable row level security;
alter table public.payments enable row level security;
alter table public.audit_log enable row level security;
alter table public.usage_counters enable row level security;

create policy "Owners view their own reminders"
  on public.reminders for select
  using (
    appointment_id in (
      select id from public.appointments where business_id in (
        select id from public.businesses where owner_id = auth.uid()
      )
    )
  );

create policy "Superadmins full access - reminders"
  on public.reminders for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin'));

create policy "Owners view their own payments"
  on public.payments for select
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

create policy "Superadmins full access - payments"
  on public.payments for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin'));

-- Audit log: superadmin-only, no owner access at all.
create policy "Superadmins only - audit log"
  on public.audit_log for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin'));

-- NOTE: 03_rls_policies.sql drops and replaces the reminders/payments/
-- audit_log policies above with the complete set, and adds the
-- matching policies for appointment_history and usage_counters.