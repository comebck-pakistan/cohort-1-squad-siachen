-- 17_trial_expiry.sql
-- Wave 7 (Phase 1) — 7-day free-trial lifecycle columns on businesses.
--
-- Migration applied to Supabase: <YYYY-MM-DD>
--
-- Adds:
--   trial_status     — enum tracking active | expiring_soon | expired | converted
--   trial_started_at — when the trial began (set by free-trial-signup.ts)
--   trial_ends_at    — when the trial ends (trial_started_at + 7 days)
--
-- Default trial_status='active' so pre-Wave-7 rows keep working. For those rows
-- trial_ends_at will be NULL — the bot enforcement (Phase 2) treats NULL as
-- "no expiry", so existing salons continue working unchanged.

create type trial_status as enum ('active', 'expiring_soon', 'expired', 'converted');

alter table public.businesses
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at    timestamptz,
  add column if not exists trial_status     trial_status not null default 'active';

-- Partial index — only rows still on a trial are interesting to the cron job.
-- Keeps the index small even when most salons are converted.
create index if not exists idx_businesses_trial_ends_at
  on public.businesses (trial_ends_at)
  where trial_status in ('active', 'expiring_soon');

comment on column public.businesses.trial_status is
  'active = trial running (≤5 days left), expiring_soon = warning sent (5-7 days), expired = day 7+ (bot sends fixed fallback), converted = paid customer (no enforcement)';
