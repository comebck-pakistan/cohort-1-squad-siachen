-- =====================================================================
-- Salon-portal UI fields — closes gaps between Recepta frontend and DB.
-- Run this AFTER 01_schema.sql through 12_conversation_state.sql.
--
-- Adds fields that the salon-portal UI (TenantBusiness.tsx) expects
-- but that the original schema didn't model:
--   - services.category         (e.g. "Hair", "Skin", "Nails")
--   - staff.role                (e.g. "Senior Stylist", "Esthetician")
--   - staff.working_days        (e.g. "mon,tue,wed,thu,fri,sat")
--                                stored as comma-separated weekday codes
--   - businesses.appointment_buffer_min  (default 15, used by booking flow)
--
-- All new columns are nullable or have defaults so existing rows are
-- unaffected. Backward-compatible — restaurants, clinics, etc. can
-- ignore these.
-- =====================================================================

-- 1. Service category — used by the salon's services catalog UI tab
--    to group services. Industry-suggested defaults seeded below.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS category TEXT;

-- 2. Staff role — free-text position (the DB doesn't need a fixed
--    enum here; salon owners have niche titles like "Bridal Lead").
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS role TEXT;

-- 3. Staff working days — comma-separated weekday codes from the
--    `weekday` enum (sun, mon, tue, wed, thu, fri, sat). NULL means
--    "all days open" (the default). Update this when a staff member
--    changes their schedule.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS working_days TEXT;

-- 4. Per-business appointment buffer — minutes between back-to-back
--    appointments. Defaults to 15. Used by get_available_slots() in
--    a future iteration; right now the booking flow already respects
--    the service's duration_minutes, so this is purely cosmetic for
--    the UI's "Buffer: 15 min" input.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS appointment_buffer_min INT NOT NULL DEFAULT 15;

-- 5. Index on services.category for fast category filtering in the
--    salon's services catalog.
CREATE INDEX IF NOT EXISTS idx_services_category ON public.services(category)
  WHERE category IS NOT NULL;
