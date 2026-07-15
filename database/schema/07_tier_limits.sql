-- =====================================================================
-- SalonIQ — Dynamic Feature & Tier Configuration Limits
-- Run this AFTER 03_rls_policies.sql
--
-- CHANGELOG (this revision):
-- - This is now the ONLY file that defines `tier_limits`. It used to
--   also be (re)defined in 02_migration_v1_1.sql with a different,
--   incompatible column set (max_appointments_per_month /
--   max_messages_per_month vs. this file's max_appointments_mo /
--   max_staff_members / max_custom_rules / allow_* flags). Because
--   02 ran first with a plain `create table` and this file used
--   `CREATE TABLE IF NOT EXISTS`, Postgres silently skipped creating
--   this file's extra columns — then the INSERT below referenced
--   columns that didn't exist and errored out.
-- - Folded in `max_messages_mo` (renamed from `max_messages_per_month`
--   in the old 02 version) so usage_counters.messages_count still has
--   a quota to be checked against, since 02 no longer defines that
--   column anywhere else.
-- - Removed the "Superadmins manage tier limits" policy that used to
--   ALSO be created in 03_rls_policies.sql — same name, same table,
--   would fail with a "policy already exists" error on whichever file
--   ran second. tier_limits policies now live only here.
-- - Renamed `allow_payments` -> `allow_client_card_payments`. The old
--   name was ambiguous (read as "can this salon accept payment at
--   all," which manual JazzCash transfer doesn't need gating for). The
--   new name is specifically about a future in-app card checkout
--   feature for the salon's own clients, gated by tier.
--
-- ⚠️ DEV-CONVENIENCE WARNING: the `DROP TABLE IF EXISTS ... CASCADE`
-- below wipes `tier_limits` and re-seeds it from scratch every time
-- this file runs — convenient while the schema is still changing, but
-- destructive if ever run against a live project where a superadmin
-- has manually customized any tier's limits. Remove the DROP once this
-- table is stable, or gate it behind an explicit "yes I mean it" step
-- before ever pointing this at a real/production Supabase project.
-- =====================================================================

-- Drop the old table if it exists to ensure structural changes (renamed column) apply
DROP TABLE IF EXISTS public.tier_limits CASCADE;

CREATE TABLE public.tier_limits (
  tier                       business_tier PRIMARY KEY, -- 'basic', 'pro', or 'business'
  max_appointments_mo        int NOT NULL,              -- Monthly booking cap
  max_messages_mo            int NOT NULL,              -- Monthly WhatsApp message cap
  max_staff_members          int NOT NULL,              -- Stylist limit per business
  max_custom_rules           int NOT NULL,              -- Max rows allowed in edge_case_rules per salon
  allow_client_card_payments boolean NOT NULL DEFAULT false, -- Gated in-app payment gateway features for client checkout
  allow_reminders            boolean NOT NULL DEFAULT false, -- Access to WhatsApp text automation
  allow_human_handoff        boolean NOT NULL DEFAULT false  -- Can toggle bot off for live messaging
);

-- Enable Row Level Security to match your architecture standards
ALTER TABLE public.tier_limits ENABLE ROW LEVEL SECURITY;

-- Anyone (including salon owners) can read tier rules to see what features they get
CREATE POLICY "Everyone can view tier limits configuration"
  ON public.tier_limits FOR SELECT
  TO authenticated
  USING (true);

-- Only your root team can adjust limits or prices
CREATE POLICY "Superadmins manage tier limits"
  ON public.tier_limits FOR ALL
  USING (public.is_superadmin());

-- ---------------------------------------------------------------------
-- SEED: Define the Exact Rules for Your 3 App Tiers
-- ---------------------------------------------------------------------
-- max_custom_rules: 5 / 10 / 15 (Basic / Pro / Business) — enforced at
-- insert time by the trigger in 10_edge_case_rule_limits.sql.
INSERT INTO public.tier_limits 
  (tier, max_appointments_mo, max_messages_mo, max_staff_members, max_custom_rules, allow_client_card_payments, allow_reminders, allow_human_handoff)
VALUES
  ('basic',    100,   1000,  1,  5,  false, false, false), -- Basic Plan (Solo Operators)
  ('pro',      1000,  5000,  10, 10, true,  true,  false), -- Pro Plan (Standard Growth Salons)
  ('business', 99999, 99999, 99, 15, true,  true,  true)   -- Business Plan (Franchises / High Volume)
ON CONFLICT (tier) DO UPDATE SET
  max_appointments_mo        = EXCLUDED.max_appointments_mo,
  max_messages_mo            = EXCLUDED.max_messages_mo,
  max_staff_members          = EXCLUDED.max_staff_members,
  max_custom_rules           = EXCLUDED.max_custom_rules,
  allow_client_card_payments = EXCLUDED.allow_client_card_payments,
  allow_reminders            = EXCLUDED.allow_reminders,
  allow_human_handoff        = EXCLUDED.allow_human_handoff;