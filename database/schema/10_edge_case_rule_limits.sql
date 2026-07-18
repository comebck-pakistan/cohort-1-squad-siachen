-- =====================================================================
-- SalonIQ Schema — v1.4 Migration
-- Enforces `tier_limits.max_custom_rules` at insert time, and updates
-- the actual limits to 5 (Basic) / 10 (Pro) / 15 (Business).
--
-- Run this AFTER 09_business_capacity.sql
-- =====================================================================

-- =====================================================================
-- 1. UPDATE TIER LIMITS
-- =====================================================================
-- Previous seed values (07_tier_limits.sql) were 0 / 15 / 99. Business
-- decision: every tier gets some custom rule allowance, capped lower
-- as you go down — 5 (Basic) / 10 (Pro) / 15 (Business).

update public.tier_limits set max_custom_rules = 5  where tier = 'basic';
update public.tier_limits set max_custom_rules = 10 where tier = 'pro';
update public.tier_limits set max_custom_rules = 15 where tier = 'business';

-- =====================================================================
-- 2. ENFORCE THE CAP
-- =====================================================================
-- Counts a business's own custom rules (business_id IS NOT NULL —
-- platform rules don't count against anyone's quota) and blocks the
-- insert if they're already at their tier's limit.
--
-- ASSUMPTION: a rule counts toward the cap whether it's currently
-- toggled on or off (is_active = false). Temporarily disabling a rule
-- doesn't free up a slot — it still "belongs" to them. If you'd rather
-- only count active rules (so a paused rule doesn't count), that's a
-- one-line change (add "and is_active = true" to the count query below)
-- — let me know if you want that instead.

create or replace function public.enforce_custom_rule_limit()
returns trigger
language plpgsql
as $$
declare
  v_tier business_tier;
  v_limit int;
  v_current_count int;
begin
  -- Platform-level rules (business_id IS NULL) are superadmin-only
  -- anyway per RLS, and don't count against any business's quota.
  if new.business_id is null then
    return new;
  end if;

  select b.tier into v_tier
  from public.businesses b
  where b.id = new.business_id;

  select max_custom_rules into v_limit
  from public.tier_limits
  where tier = v_tier;

  select count(*) into v_current_count
  from public.edge_case_rules
  where business_id = new.business_id;

  if v_current_count >= v_limit then
    raise exception 'Custom rule limit reached for this tier (% of % used). Upgrade your plan to add more.',
      v_current_count, v_limit;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_custom_rule_limit
  before insert on public.edge_case_rules
  for each row execute function public.enforce_custom_rule_limit();

-- =====================================================================
-- Notes for the frontend:
-- =====================================================================
-- - The "Add New Rule" button in your edge-cases mockup should catch
--   this specific Postgres exception and surface it as a friendly
--   upgrade prompt rather than a raw error, e.g.:
--     "You've used all 5 custom rules on your Basic plan — upgrade to
--      Pro for 10."
-- - Consider also checking the count client-side before showing the
--   "Add New Rule" button at all (disable it once at the cap), so the
--   owner doesn't hit the error in the first place — the trigger is
--   the backstop, not meant to be the primary UX.
-- =====================================================================
