-- =====================================================================
-- SalonIQ Schema — v1.3 Migration
-- Adds: salon-wide capacity status (distinct from per-service
-- availability), for the "this slot/day is fully booked" calendar
-- indicator.
--
-- Context: get_available_slots() (01_schema.sql) answers "is a
-- qualified staff member free for THIS SERVICE at time T" — it's
-- scoped to one service. It does NOT answer "is the whole salon
-- booked solid at time T, regardless of service" — which is what a
-- calendar day/slot indicator needs. This file adds that.
--
-- ASSUMPTION (flagged, please confirm): capacity = total active staff
-- headcount. If a salon's real bottleneck is something else — e.g.
-- physical chairs/stations fewer than staff — this needs an explicit
-- `businesses.max_concurrent_appointments` column instead of deriving
-- from staff count. Easy to add later if that turns out to be true for
-- FABS or other pilot salons; not added here since headcount matches
-- what you described.
--
-- Run this AFTER 08_migration_v1_2.sql
-- =====================================================================

-- =====================================================================
-- 1. SLOT-LEVEL CAPACITY STATUS
-- =====================================================================
-- For a given business + date, steps through the day in fixed
-- intervals and reports, per slot: how many active staff exist, how
-- many are already booked (any service, not just one), and whether
-- that means the salon is fully booked at that moment.
--
-- Unlike get_available_slots(), this ignores service/skill matching
-- entirely — it's asking "is anyone at all free," not "is the right
-- specialist free."

create or replace function public.get_business_capacity_slots(
  p_business_id uuid,
  p_date date,
  p_interval_minutes int default 30
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  active_staff_count int,
  booked_staff_count int,
  is_fully_booked boolean
)
language plpgsql
as $$
declare
  v_day weekday;
  v_open time;
  v_close time;
  v_is_open boolean;
  v_is_holiday boolean;
  v_active_staff_count int;
begin
  v_day := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_date)::int + 1]::weekday;

  select is_open, open_time, close_time into v_is_open, v_open, v_close
  from public.business_hours
  where business_id = p_business_id and day_of_week = v_day;

  select exists(
    select 1 from public.holidays where business_id = p_business_id and date = p_date
  ) into v_is_holiday;

  if not v_is_open or v_is_holiday then
    return; -- salon closed: no slots, capacity question doesn't apply
  end if;

  -- Staff who are actually workable that day: active, not marked
  -- off/sick via staff_availability override.
  select count(*) into v_active_staff_count
  from public.staff st
  left join public.staff_availability sa on sa.staff_id = st.id and sa.date = p_date
  where st.business_id = p_business_id
    and st.is_active = true
    and coalesce(sa.status, 'available') = 'available';

  return query
  with slots as (
    select generate_series(
      ('2000-01-01'::date + v_open)::timestamp,
      ('2000-01-01'::date + v_close)::timestamp - (p_interval_minutes || ' minutes')::interval,
      (p_interval_minutes || ' minutes')::interval
    )::time as slot_time
  )
  select
    (p_date + s.slot_time)::timestamptz as slot_start,
    (p_date + s.slot_time + (p_interval_minutes || ' minutes')::interval)::timestamptz as slot_end,
    v_active_staff_count as active_staff_count,
    (
      select count(distinct ap.staff_id)
      from public.appointments ap
      where ap.business_id = p_business_id
        and ap.status in ('pending', 'confirmed')
        and tstzrange(ap.start_time, ap.end_time) && tstzrange(
          (p_date + s.slot_time)::timestamptz,
          (p_date + s.slot_time + (p_interval_minutes || ' minutes')::interval)::timestamptz
        )
    ) as booked_staff_count,
    (
      v_active_staff_count > 0
      and (
        select count(distinct ap.staff_id)
        from public.appointments ap
        where ap.business_id = p_business_id
          and ap.status in ('pending', 'confirmed')
          and tstzrange(ap.start_time, ap.end_time) && tstzrange(
            (p_date + s.slot_time)::timestamptz,
            (p_date + s.slot_time + (p_interval_minutes || ' minutes')::interval)::timestamptz
          )
      ) >= v_active_staff_count
    ) as is_fully_booked
  from slots s;
end;
$$;

-- =====================================================================
-- 2. DAY-LEVEL ROLLUP (what the calendar dot/badge actually needs)
-- =====================================================================
-- The calendar mockup shows a dot or badge per day, not a per-slot
-- breakdown. This wraps the function above into a single boolean per
-- day: "is any part of this day fully booked" — cheap enough to call
-- once per visible month when rendering the calendar grid.

create or replace function public.is_business_day_fully_booked(
  p_business_id uuid,
  p_date date
)
returns boolean
language sql
stable
as $$
  select coalesce(bool_or(is_fully_booked), false)
  from public.get_business_capacity_slots(p_business_id, p_date);
$$;

-- =====================================================================
-- Notes for the frontend / bot integration:
-- =====================================================================
-- - Calendar month view: for each visible day, call
--   is_business_day_fully_booked(business_id, day) to decide whether
--   to render a "Fully Booked" badge (matches the existing "Public
--   Holiday" badge pattern already in your calendar mockup).
-- - WhatsApp bot: before even checking get_available_slots() for a
--   specific service, it's cheaper to short-circuit with
--   is_business_day_fully_booked() when a customer asks something
--   generic like "are you free tomorrow at 3pm" without naming a
--   service yet.
-- - No new RLS needed — these are plain functions (not security
--   definer), so they run under the caller's existing permissions.
--   An owner calling this for their own business is already covered
--   by the existing RLS on `staff`, `appointments`, `business_hours`,
--   and `holidays` from 01_schema.sql / 03_rls_policies.sql.
-- =====================================================================
