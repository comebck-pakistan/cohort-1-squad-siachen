# SalonIQ Database

```
database/
├── README.md
├── schema/     — table/enum/function/trigger/RLS definitions (DDL only)
│   ├── 01_schema.sql
│   ├── 02_migration_v1_1.sql
│   ├── 03_rls_policies.sql
│   ├── 04_auth_trigger.sql
│   ├── 05_whatsapp_sessions.sql
│   ├── 06_edge_case_rules.sql
│   ├── 07_tier_limits.sql        
│   ├── 08_migration_v1_2.sql
│   ├── 09_business_capacity.sql
│   └── 10_edge_case_rule_limits.sql
└── seed/       — data only, no schema changes
    ├── 06_edge_case_rules_seed.sql
    └── 07_test_users_seed.sql
```


## How to run

1. Run every file in `schema/`, in numeric order, `01` through `10`, one at a time.
2. Run every file in `seed/`, in numeric order (`06` then `07`).

Both seed files depend on schema being fully in place first — `06_edge_case_rules_seed.sql` needs `edge_case_rules` (schema `01`/`06`) already populated, and `07_test_users_seed.sql` needs `profiles` + the auth trigger (schema `04`) already working. Running all of `schema/` before all of `seed/` satisfies both, so you don't need to interleave them.

---

## `schema/` — what's in each file

### `01_schema.sql`
The foundation. Every core table (`profiles`, `businesses`, `business_hours`, `holidays`, `services`, `staff`, `staff_skills`, `staff_availability`, `staff_breaks`, `customers`, `appointments`, `conversations`, `messages`, `edge_case_rules`, `escalation_events`, `promotions`, `subscriptions`), the enums they use, base RLS enablement, and two key pieces of logic:
- `no_overlapping_staff_appointments` — a DB-level exclusion constraint preventing any staff member from being double-booked, even under concurrent writes.
- `get_available_slots(business_id, service_id, date)` — returns bookable slots for one specific service, correctly requiring `staff_required` distinct staff to be simultaneously free (fixed from an earlier version that only checked for one free staff member regardless of how many a service needed). Returns `available_staff_ids uuid[]`, not a single `staff_id` — any calling code needs to read it as an array.

### `02_migration_v1_1.sql`
Adds: `reminders` (per-appointment reminder attempts), `appointment_history` (immutable reschedule/cancellation log), `payments` (transaction log backing revenue stats and billing-state transitions), `audit_log` (superadmin action log), `usage_counters` (per-business monthly appointment/message counts), and three dashboard views (`business_daily_stats`, `business_monthly_customers`, `platform_stats`). Does **not** define `tier_limits` — that used to live here but was removed to avoid conflicting with file `07`.

### `03_rls_policies.sql`
The full, tested Row Level Security policy set for everything in `01` and `02`: superadmin-full-access + owner-scoped-to-their-own-business, for every table. Defines `public.is_superadmin()`, the helper every other file's policies rely on. Does **not** touch `tier_limits` policies — those live only in `07`, to avoid a duplicate-policy-name error.

### `04_auth_trigger.sql`
One trigger: auto-creates a `profiles` row (defaulted to `business_owner`) whenever someone signs up via Supabase Auth. Required for `03`'s policies to work for any new user — without it, a fresh signup has no role and gets blocked from everything.

### `05_whatsapp_sessions.sql`
`whatsapp_sessions` — maps an incoming WhatsApp phone number to a `business_id` and a `context_mode` (`customer`/`owner`/`staff`), so one shared WhatsApp Business number can route messages to the right salon. Owner-scoped + superadmin RLS.

### `06_edge_case_rules.sql`
Creates `edge_case_test_scenarios` (+ its RLS) and inserts the 40 platform-level guardrail rules (`business_id = NULL`) across Safety & Medical, Booking Integrity, Financial/Pricing, and Communication/Tone. These apply to every salon automatically and can't be disabled by an owner. Plain `INSERT`, no CTE — an earlier version tried to share a `WITH` clause with the seed file below, which doesn't work across separate statements.

### `07_tier_limits.sql`
The sole definition of `tier_limits`: `max_appointments_mo`, `max_messages_mo`, `max_staff_members`, `max_custom_rules`, `allow_client_card_payments`, `allow_reminders`, `allow_human_handoff`. Seeded with your 3 real tiers (Basic Rs 5,000 / Pro Rs 12,000 / Business Rs 25,000; `max_custom_rules` 5/10/15). Opens with `DROP TABLE IF EXISTS ... CASCADE` for clean re-runs while iterating — remove that once this table's shape is stable, since it'd wipe any live customization if run against a production project. `allow_client_card_payments` was renamed from `allow_payments` to be specific to a future in-app card checkout feature, not "can this salon pay you at all" (manual JazzCash transfer isn't gated by this).

### `08_migration_v1_2.sql`
Four additions found by cross-checking the schema against the Stitch mockups: `business_onboarding_intake` (onboarding Step 5's contact-methods + common-questions data), `onboarding_status` on `businesses` (+ a `businesses_pending_onboarding` superadmin worklist view, + a trigger stopping owners from self-verifying their own signup), `promotions.source`/`created_by` (AI-suggested vs. owner-created), and `business_current_month_usage` (per-salon monthly usage view for the superadmin table).

### `09_business_capacity.sql`
Two functions answering "is the whole salon booked solid," independent of any one service — distinct from `get_available_slots()`, which only answers that for one specific service. `get_business_capacity_slots()` returns per-slot active/booked staff counts and a fully-booked flag; `is_business_day_fully_booked()` collapses that to one boolean per day, meant to back a "Fully Booked" badge on the calendar view. Assumes capacity = total active staff headcount (flagged in the file — would need a different column if physical stations/chairs are the real bottleneck instead).

### `10_edge_case_rule_limits.sql`
One trigger, `enforce_custom_rule_limit()`, blocking an owner from inserting a new custom edge-case rule once they've hit their tier's `max_custom_rules`. Platform rules (`business_id IS NULL`) are exempt. A paused (`is_active = false`) rule still counts toward the cap.

---

## `seed/` — what's in each file

### `06_edge_case_rules_seed.sql`
5 representative test scenarios (one per rule category) inserted into `edge_case_test_scenarios`, matched to their rule by looking up `rule_text` directly against the already-committed `edge_case_rules` table — no CTE dependency on `06_edge_case_rules.sql`'s statement. Not exhaustive; meant as a starting point for your squad to add real regression cases to.

### `07_test_users_seed.sql`
**Dev/testing only — never run against a production project.** Inserts two working logins directly into `auth.users`: a superadmin (`admin@saloniq.com`) and a business owner (`owner@myhairsalon.com`), both with fixed UUIDs for easy reference elsewhere, plus `instance_id` (required by Supabase's Auth service, GoTrue, or these rows can exist but fail to sign in through the normal SDK). Contains real, working, hardcoded plaintext passwords — keep this file out of any public repo. The test owner has no `businesses` row yet, so their dashboard renders empty until you insert one manually with `owner_id` pointing at that user.

---

## Verifying the setup

After running everything, confirm the auth trigger exists:
```sql
select trigger_name from information_schema.triggers
where trigger_name = 'on_auth_user_created';
```

Confirm `tier_limits` has exactly the 7-column shape (no leftover duplicate definitions from `02`):
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'tier_limits';
```
