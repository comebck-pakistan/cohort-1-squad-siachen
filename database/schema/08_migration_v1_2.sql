-- =====================================================================
-- SalonIQ Schema — v1.2 Migration
-- Fills 4 gaps found reviewing the schema against the Stitch mockups:
--   1. Onboarding Step 5 (contact methods / common questions) had
--      nowhere to be stored.
--   2. No way to represent "submitted, pending superadmin review" vs.
--      "verified and live" — mockup promises this, schema didn't have it.
--   3. Promotions couldn't distinguish AI-suggested vs. owner-created.
--   4. Superadmin's per-salon "Messages (Mo)" column had no query to
--      back it (only an all-time platform total existed).
--
-- Run this AFTER 07_tier_limits.sql
-- =====================================================================

-- =====================================================================
-- 1. ONBOARDING INTAKE (Step 5: "How do customers contact you now?")
-- =====================================================================
-- One row per business, captured once at signup. Feeds the AI's
-- initial context and lets you see what a salon's pre-SalonIQ workflow
-- looked like — useful both for the agent and for your own research
-- (this is the same kind of data your Week 1 freelancer interviews
-- were built on, just captured per-salon going forward).

create table public.business_onboarding_intake (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,

  -- matches the 4 checkboxes in onboarding step 5
  contact_methods text[] not null default '{}',  -- subset of: 'whatsapp','phone','instagram_dm','walk_in'
  common_customer_questions text,                 -- free-text field from the same screen

  created_at timestamptz not null default now(),
  unique (business_id) -- one intake snapshot per business; re-running onboarding overwrites via upsert
);

alter table public.business_onboarding_intake enable row level security;

create policy "Owners manage own onboarding intake"
  on public.business_onboarding_intake for all
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

create policy "Superadmins full access - business_onboarding_intake"
  on public.business_onboarding_intake for all
  using (public.is_superadmin());

-- =====================================================================
-- 2. ONBOARDING / VERIFICATION STATUS
-- =====================================================================
-- Separate from `billing_state` (active/grace_period/suspended), which
-- only makes sense for a salon that's already live. This tracks the
-- "did our team actually review and greenlight this signup" workflow
-- that Step 6 of onboarding promises ("Our team will contact you
-- within 24 hours").

create type onboarding_status as enum ('pending_review', 'verified', 'rejected');

alter table public.businesses
  add column onboarding_status onboarding_status not null default 'pending_review',
  add column onboarding_submitted_at timestamptz not null default now(),
  add column onboarding_verified_at timestamptz,
  add column onboarding_verified_by uuid references public.profiles(id);

-- Superadmin worklist: "which new signups still need review"
create or replace view public.businesses_pending_onboarding as
select id, name, city, whatsapp_number, onboarding_submitted_at
from public.businesses
where onboarding_status = 'pending_review'
order by onboarding_submitted_at asc;

-- SECURITY: the existing "Owners update own business" policy (from
-- 03_rls_policies.sql) has no column restriction — as written, an
-- owner could directly set their own onboarding_status to 'verified'
-- and self-approve, bypassing the whole review step. RLS policies
-- can't restrict individual columns on their own, so we close this
-- with a trigger instead: any change to the onboarding_* columns that
-- isn't made by a superadmin gets rejected.

create or replace function public.protect_onboarding_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    if new.onboarding_status is distinct from old.onboarding_status
       or new.onboarding_verified_at is distinct from old.onboarding_verified_at
       or new.onboarding_verified_by is distinct from old.onboarding_verified_by then
      raise exception 'Only a superadmin can change onboarding review status';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_protect_onboarding_columns
  before update on public.businesses
  for each row execute function public.protect_onboarding_columns();

-- =====================================================================
-- 3. PROMOTIONS — AI-suggested vs. owner-created
-- =====================================================================
-- Backs the "AI Suggested" tag shown on the promotions card in the
-- calendar/promotions mockup.

alter table public.promotions
  add column source text not null default 'owner' check (source in ('owner', 'ai_suggested')),
  add column created_by uuid references public.profiles(id); -- null when source = 'ai_suggested' (bot uses service role)

-- No new RLS needed — existing owner-scoped policy on `promotions`
-- already covers these new columns since it's row-level, not column-level.

-- =====================================================================
-- 4. PER-BUSINESS MONTHLY USAGE (Superadmin "Messages (Mo)" column)
-- =====================================================================
-- usage_counters already tracks this per business per month — it just
-- had no view exposing "this salon, this month" for the Active Salons
-- table. platform_stats (from 02) only gives the platform-wide total.

create or replace view public.business_current_month_usage as
select
  uc.business_id,
  uc.appointments_count,
  uc.messages_count
from public.usage_counters uc
where uc.period_start = date_trunc('month', now())::date;

-- =====================================================================
-- Views don't need RLS enabled directly — Postgres enforces the RLS
-- of the underlying tables (businesses, usage_counters) for whoever
-- queries the view, so access is already scoped correctly.
-- =====================================================================
