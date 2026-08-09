-- 18_waitlist_leads.sql
-- Wave 8 — Landing page waitlist capture.
--
-- Replaces the previous landing-page CTA "Get Started" with an honest
-- waitlist signup while we're still in early access and not running
-- self-serve payment. The landing-page hero form POSTs to
-- POST /api/waitlist on the backend, which inserts here using the
-- service-role Supabase key (bypasses RLS).
--
-- Schema mirrors the pattern from
--   15_public_onboarding_submissions.sql
-- — same UUID id, same `created_at timestamptz default now()`.
--
-- RLS posture:
--   - INSERT through the anon Supabase key is DENIED (no WITH CHECK
--     policy allows anon). Only the backend can write, which means
--     all inserts pass through the validation in routes/waitlist.ts.
--   - SELECT/UPDATE/DELETE through the anon key is DENIED.
--   - The service-role key bypasses RLS, so the backend can INSERT
--     without a policy.
--   - The single policy here lets superadmins (via the
--     public.is_superadmin() helper) read leads — useful for future
--     admin UI. Out of scope for the current landing page.

create table if not exists public.waitlist_leads (
  id uuid primary key default gen_random_uuid(),
  -- All four below are required so we can actually follow up with
  -- the lead. Phone + email both required per the landing-page audit.
  name text not null,
  salon_name text not null,
  phone text not null,
  email text not null,
  -- Optional but useful for tailoring the manual onboarding call.
  salon_type text,
  created_at timestamptz not null default now()
);

create index if not exists idx_waitlist_leads_created_at
  on public.waitlist_leads (created_at desc);

alter table public.waitlist_leads enable row level security;

create policy "Superadmins full access - waitlist leads"
  on public.waitlist_leads for all
  using (public.is_superadmin())
  with check (public.is_superadmin());

comment on table public.waitlist_leads is
  'Pre-launch waitlist captures from the landing page hero. Backend inserts via service-role; anon Supabase REST is denied (no anon policy) so all writes pass through routes/waitlist.ts validation.';