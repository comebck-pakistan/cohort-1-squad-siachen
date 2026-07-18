-- =====================================================================
-- Seed Test Users (Auth & Profiles) — DEV/TESTING ONLY
-- Lives in seed/. Run this AFTER every file in schema/ (01 through 10)
-- has already run — this needs `profiles`, the auth trigger, and
-- `businesses` all in place first.
--
-- ⚠️ THIS REPO IS PUBLIC. Before running this file, replace both
-- 'CHANGE_ME_ADMIN_PW' and 'CHANGE_ME_OWNER_PW' below with your own
-- passwords, locally, and never commit your real values back to this
-- file. The placeholders are intentionally not usable passwords.
--
-- CHANGELOG:
-- - Added `instance_id`. Supabase's GoTrue (the actual auth service)
--   expects every auth.users row to have a valid instance_id — usually
--   the all-zeros UUID. Without it, these rows may exist in the table
--   but fail to authenticate through the normal Supabase Auth API
--   (sign-in via SDK), even though the raw INSERT succeeds.
--
-- ⚠️ SECURITY / HYGIENE WARNINGS — read before using:
-- 1. Inserting directly into `auth.users` via SQL is fragile. Supabase
--    explicitly recommends `supabase.auth.admin.createUser()` (Admin
--    API, e.g. from a small Node/Python script using the service role
--    key) over raw SQL for this reason — GoTrue owns several internal
--    invariants on this table that aren't obvious from the schema
--    alone, and can silently drift as Supabase updates it. Treat this
--    file as a quick local/dev convenience, not a long-term pattern.
-- 2. These are real, working, hardcoded plaintext passwords committed
--    to a file. If this file (or its git history) ever reaches your
--    public MARRIYAM07 GitHub repos, anyone can log in as your test
--    superadmin. Keep this file out of any public repo, or in a
--    .gitignore'd local-only seeds folder — never push it as-is.
-- 3. Only ever run this against a local/dev/staging Supabase project.
--    Never run it against the project your real WhatsApp number and
--    FABS's real data eventually live in.
-- =====================================================================

-- 1. Create a Test Superadmin (for platform-wide admin testing)
INSERT INTO auth.users (
  instance_id, id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, role, aud
)
VALUES (
  '00000000-0000-0000-0000-000000000000',                  -- Supabase's default instance_id
  '11111111-1111-1111-1111-111111111111',                  -- Fixed UUID for easy reference
  'admin@saloniq.com',                                      -- Superadmin Login Email
  crypt('CHANGE_ME_ADMIN_PW', gen_salt('bf')),              -- Encrypted Password — replace locally, never commit real value
  now(),
  '{"full_name": "Platform Admin"}'::jsonb,
  now(),
  now(),
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Force role to 'superadmin' (since the trigger defaults to 'business_owner')
UPDATE public.profiles 
SET role = 'superadmin' 
WHERE id = '11111111-1111-1111-1111-111111111111';

-- 2. Create a Test Salon Owner (for standard dashboard testing)
INSERT INTO auth.users (
  instance_id, id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, role, aud
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',                  -- Fixed UUID
  'owner@myhairsalon.com',                                  -- Salon Owner Login Email
  crypt('CHANGE_ME_OWNER_PW', gen_salt('bf')),              -- Encrypted Password — replace locally, never commit real value
  now(),
  '{"full_name": "Salon Owner"}'::jsonb,
  now(),
  now(),
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;
-- No role update needed — the auth trigger (file 04) already defaults
-- new signups to 'business_owner'.

-- NOTE: this only creates the login + profile. There's no `businesses`
-- row owned by this test user yet, so their dashboard would render
-- empty. If you want to actually test the owner dashboard end to end,
-- insert a test business row with owner_id =
-- '22222222-2222-2222-2222-222222222222' as a follow-up step.