-- =====================================================================
-- FABS Beauty Lounge & Salon — Sample Seed Data
-- =====================================================================
-- All prices are DUMMY placeholder values (mid-range of the price ranges
-- in the source data sheet). Service durations are best-guess estimates
-- (real data to be added once the salon confirms).
--
-- Re-runnable: deletes prior FABS data before re-inserting so the script
-- can be applied more than once safely. Doesn't touch any other business.
--
-- Apply in Supabase SQL editor.
-- =====================================================================

DO $$
DECLARE
  v_business_id uuid;
  v_count int;
BEGIN

  -- -------------------------------------------------------------------
  -- 1. Businesses — get or create FABS
  -- -------------------------------------------------------------------
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE name = 'FABS Beauty Lounge & Salon'
  LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.businesses (
      name, business_type, city, whatsapp_number, agent_active
    ) VALUES (
      'FABS Beauty Lounge & Salon', 'salon', 'Islamabad',
      '+923001234567', true
    )
    RETURNING id INTO v_business_id;
  END IF;

  -- Clean prior seed data (idempotent re-seed)
  DELETE FROM public.staff_skills
    WHERE staff_id IN (SELECT id FROM public.staff WHERE business_id = v_business_id);
  DELETE FROM public.staff_breaks
    WHERE staff_id IN (SELECT id FROM public.staff WHERE business_id = v_business_id);
  DELETE FROM public.staff_availability
    WHERE staff_id IN (SELECT id FROM public.staff WHERE business_id = v_business_id);
  DELETE FROM public.staff WHERE business_id = v_business_id;
  DELETE FROM public.services WHERE business_id = v_business_id;
  DELETE FROM public.business_hours WHERE business_id = v_business_id;

  -- -------------------------------------------------------------------
  -- 2. Business hours (Friday opens 14:00 for Jummah)
  -- -------------------------------------------------------------------
  INSERT INTO public.business_hours (business_id, day_of_week, is_open, open_time, close_time)
  VALUES
    (v_business_id, 'mon', true, '11:00', '20:00'),
    (v_business_id, 'tue', true, '11:00', '20:00'),
    (v_business_id, 'wed', true, '11:00', '20:00'),
    (v_business_id, 'thu', true, '11:00', '21:00'),
    (v_business_id, 'fri', true, '14:00', '21:00'),
    (v_business_id, 'sat', true, '10:00', '21:00'),
    (v_business_id, 'sun', true, '10:00', '21:00');

  -- -------------------------------------------------------------------
  -- 3. Staff (10 members)
  -- -------------------------------------------------------------------
  INSERT INTO public.staff (business_id, name, is_active) VALUES
    (v_business_id, 'Ayesha Malik',     true),  -- Senior Stylist / Manager
    (v_business_id, 'Sana Khalid',      true),  -- Bridal Makeup Lead
    (v_business_id, 'Mehwish Tariq',    true),  -- Makeup Artist
    (v_business_id, 'Rabia Yousaf',     true),  -- Hair Stylist
    (v_business_id, 'Fiza Anwar',       true),  -- Hair Colorist
    (v_business_id, 'Nimra Baig',       true),  -- Nail Technician
    (v_business_id, 'Hina Shoukat',     true),  -- Skincare Specialist
    (v_business_id, 'Ushna Riaz',       true),  -- Junior Stylist
    (v_business_id, 'Zoya Ahmed',       true),  -- Massage Therapist
    (v_business_id, 'Saba Ilyas',       true);  -- Receptionist (no service skills)

  -- -------------------------------------------------------------------
  -- 4. Services (~75 rows, dummy prices = mid-range, dummy durations)
  -- -------------------------------------------------------------------
  INSERT INTO public.services (business_id, name, duration_minutes, staff_required, price, is_active) VALUES

    -- A. Hair Cutting & Styling (12)
    (v_business_id, 'Hair cut (trim only)',           30, 1,   650, true),
    (v_business_id, 'Hair cut (layers / step cut)',   45, 1,  1150, true),
    (v_business_id, 'U-cut / blunt cut',              30, 1,   950, true),
    (v_business_id, 'Fringe / bangs trim',            15, 1,   400, true),
    (v_business_id, 'Kids haircut (under 10)',        20, 1,   500, true),
    (v_business_id, 'Blow-dry (short hair)',           30, 1,   750, true),
    (v_business_id, 'Blow-dry (medium hair)',          30, 1,  1100, true),
    (v_business_id, 'Blow-dry (long hair)',            45, 1,  1550, true),
    (v_business_id, 'Hair ironing / straightening',   45, 1,  1150, true),
    (v_business_id, 'Curls / tong styling',           45, 1,  1400, true),
    (v_business_id, 'Hair updo / open styling',       60, 1,  3250, true),
    (v_business_id, 'Bridal hairstyling (only)',      90, 1,  7500, true),

    -- B. Hair Coloring & Chemical Treatments (12)
    (v_business_id, 'Root touch-up',                  60, 1,  2750, true),
    (v_business_id, 'Global hair color (short)',      90, 1,  4750, true),
    (v_business_id, 'Global hair color (long)',      150, 1,  8000, true),
    (v_business_id, 'Highlights (partial)',          120, 1,  6250, true),
    (v_business_id, 'Highlights (full head)',        180, 1, 11500, true),
    (v_business_id, 'Balayage / ombre',              180, 1, 15000, true),
    (v_business_id, 'Henna application (natural)',    60, 1,  2250, true),
    (v_business_id, 'Hair rebonding',                240, 1, 13000, true),
    (v_business_id, 'Keratin treatment',             180, 1, 10500, true),
    (v_business_id, 'Nanoplastia / protein treatment',180, 1, 12000, true),
    (v_business_id, 'Hair botox',                    150, 1,  8500, true),
    (v_business_id, 'Smoothening',                   180, 1, 10000, true),

    -- C. Hair Care & Spa (7)
    (v_business_id, 'Basic hair wash + conditioner',   20, 1,   550, true),
    (v_business_id, 'Deep conditioning treatment',     45, 1,  2250, true),
    (v_business_id, 'Hair spa (mild damage)',          60, 1,  3500, true),
    (v_business_id, 'Hair spa (severe damage)',        75, 1,  6000, true),
    (v_business_id, 'Scalp treatment (dandruff / hair fall)', 45, 1, 3000, true),
    (v_business_id, 'Head massage (oil)',              30, 1,  1150, true),
    (v_business_id, 'Hair mask (Moroccan / argan oil)',45, 1,  2400, true),

    -- D. Makeup Services (12)
    (v_business_id, 'Daytime / casual makeup',         30, 1,  2000, true),
    (v_business_id, 'Party makeup (basic)',            45, 1,  4000, true),
    (v_business_id, 'Party makeup (HD)',               60, 1,  6500, true),
    (v_business_id, 'Engagement makeup',               75, 1, 11500, true),
    (v_business_id, 'Bridal makeup — Barat (basic)',  120, 1, 20000, true),
    (v_business_id, 'Bridal makeup — Barat (HD / airbrush)', 150, 1, 35000, true),
    (v_business_id, 'Bridal makeup — Walima',         120, 1, 22500, true),
    (v_business_id, 'Bridal makeup — Mehndi / dholki', 90, 1, 11500, true),
    (v_business_id, 'Trial makeup session',            60, 1,  4500, true),
    (v_business_id, 'Airbrush makeup add-on',          30, 1,  4000, true),
    (v_business_id, 'False lashes application',        15, 1,   750, true),
    (v_business_id, 'Draping (saree / lehnga / dupatta)', 20, 1, 1750, true),

    -- E. Nail Care (13)
    (v_business_id, 'Regular manicure',                30, 1,  1150, true),
    (v_business_id, 'Regular pedicure',                45, 1,  1400, true),
    (v_business_id, 'Deluxe / spa manicure',           45, 1,  2400, true),
    (v_business_id, 'Deluxe / spa pedicure',           60, 1,  2750, true),
    (v_business_id, 'Nail polish change (hands)',      15, 1,   400, true),
    (v_business_id, 'Nail polish change (feet)',       15, 1,   500, true),
    (v_business_id, 'Gel polish (hands)',              45, 1,  1600, true),
    (v_business_id, 'Gel polish (feet)',               60, 1,  1850, true),
    (v_business_id, 'Acrylic nail extensions (full set)', 90, 1, 4250, true),
    (v_business_id, 'Gel nail extensions (full set)',  90, 1,  4750, true),
    (v_business_id, 'Nail art (per nail add-on)',       10, 1,   200, true),
    (v_business_id, 'Nail art (full set, detailed)',    60, 1,  1750, true),
    (v_business_id, 'Nail removal (extensions)',        30, 1,   750, true),

    -- F. Facials & Skincare (13)
    (v_business_id, 'Basic fruit facial',              45, 1,  2000, true),
    (v_business_id, 'Whitening facial',                60, 1,  2750, true),
    (v_business_id, 'Brightening / glow facial',       60, 1,  3250, true),
    (v_business_id, 'Gold facial',                     75, 1,  4750, true),
    (v_business_id, 'Diamond facial',                  75, 1,  5500, true),
    (v_business_id, 'Hydra facial',                    90, 1,  7000, true),
    (v_business_id, 'Oxygen facial',                   75, 1,  6250, true),
    (v_business_id, 'Anti-aging / collagen facial',    90, 1,  7250, true),
    (v_business_id, 'Acne-control facial',             60, 1,  4250, true),
    (v_business_id, 'Microdermabrasion',               60, 1,  5750, true),
    (v_business_id, 'Dermaplaning',                    45, 1,  4750, true),
    (v_business_id, 'Charcoal detox facial',           60, 1,  4000, true),
    (v_business_id, 'Back facial',                     60, 1,  4000, true),

    -- G. Threading, Waxing & Bleach (9)
    (v_business_id, 'Eyebrow threading',                5, 1,   225, true),
    (v_business_id, 'Upper lip threading',              5, 1,   150, true),
    (v_business_id, 'Full face threading',             15, 1,   550, true),
    (v_business_id, 'Full arms waxing',                30, 1,   950, true),
    (v_business_id, 'Full legs waxing',                45, 1,  1200, true),
    (v_business_id, 'Underarms waxing',                15, 1,   400, true),
    (v_business_id, 'Full body waxing',                90, 1,  4000, true),
    (v_business_id, 'Face bleach',                     30, 1,   700, true),
    (v_business_id, 'Full body bleach',                90, 1,  2750, true),

    -- H. Body Care & Massage (5)
    (v_business_id, 'Body massage (relaxation, 30 min)', 30, 1, 2500, true),
    (v_business_id, 'Body massage (full, 60 min)',       60, 1, 4500, true),
    (v_business_id, 'Body polish / scrub',               60, 1, 4000, true),
    (v_business_id, 'Body wrap / detox',                 75, 1, 5500, true),
    (v_business_id, 'Foot massage / reflexology',        30, 1, 2000, true),

    -- I. Bridal Packages (4) — staff_required = 2 for these
    (v_business_id, 'Basic Bridal Package',             180, 2, 25000, true),
    (v_business_id, 'Full Bridal Package (3 events)',   360, 2, 62500, true),
    (v_business_id, 'Premium Bridal Package',           480, 2,115000, true),
    (v_business_id, 'Groom grooming package',            90, 1,  4500, true);

  -- -------------------------------------------------------------------
  -- 5. Staff skills (which services each staff can perform)
  --    Mapped from the user's staff description in the data sheet.
  -- -------------------------------------------------------------------
  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Ayesha Malik'
    AND srv.name IN (
      -- Senior stylist / manager: haircuts, keratin, color correction, hair care
      'Hair cut (trim only)',
      'Hair cut (layers / step cut)',
      'U-cut / blunt cut',
      'Fringe / bangs trim',
      'Kids haircut (under 10)',
      'Blow-dry (short hair)',
      'Blow-dry (medium hair)',
      'Blow-dry (long hair)',
      'Hair ironing / straightening',
      'Curls / tong styling',
      'Hair updo / open styling',
      'Bridal hairstyling (only)',
      'Root touch-up',
      'Global hair color (short)',
      'Global hair color (long)',
      'Keratin treatment',
      'Hair rebonding',
      'Smoothening',
      'Hair botox',
      'Nanoplastia / protein treatment',
      'Balayage / ombre',
      'Basic hair wash + conditioner',
      'Deep conditioning treatment',
      'Hair spa (mild damage)',
      'Hair spa (severe damage)',
      'Scalp treatment (dandruff / hair fall)',
      'Head massage (oil)',
      'Hair mask (Moroccan / argan oil)'
    );

  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Sana Khalid'
    AND srv.name IN (
      -- Bridal makeup lead: HD, airbrush, bridal, draping
      'Bridal makeup — Barat (basic)',
      'Bridal makeup — Barat (HD / airbrush)',
      'Bridal makeup — Walima',
      'Bridal makeup — Mehndi / dholki',
      'Engagement makeup',
      'Trial makeup session',
      'Airbrush makeup add-on',
      'Draping (saree / lehnga / dupatta)',
      'Bridal hairstyling (only)',
      'Basic Bridal Package',
      'Full Bridal Package (3 events)',
      'Premium Bridal Package',
      'False lashes application'
    );

  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Mehwish Tariq'
    AND srv.name IN (
      -- Makeup artist: party, engagement, draping
      'Daytime / casual makeup',
      'Party makeup (basic)',
      'Party makeup (HD)',
      'Engagement makeup',
      'Trial makeup session',
      'Draping (saree / lehnga / dupatta)',
      'Airbrush makeup add-on'
    );

  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Rabia Yousaf'
    AND srv.name IN (
      -- Hair stylist: cutting, blow-dry, ironing, balayage
      'Hair cut (trim only)',
      'Hair cut (layers / step cut)',
      'U-cut / blunt cut',
      'Fringe / bangs trim',
      'Kids haircut (under 10)',
      'Blow-dry (short hair)',
      'Blow-dry (medium hair)',
      'Blow-dry (long hair)',
      'Hair ironing / straightening',
      'Curls / tong styling',
      'Hair updo / open styling',
      'Balayage / ombre',
      'Henna application (natural)',
      'Basic hair wash + conditioner',
      'Head massage (oil)'
    );

  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Fiza Anwar'
    AND srv.name IN (
      -- Hair colorist: global color, highlights, ombre, henna
      'Root touch-up',
      'Global hair color (short)',
      'Global hair color (long)',
      'Highlights (partial)',
      'Highlights (full head)',
      'Balayage / ombre',
      'Henna application (natural)',
      'Hair botox'
    );

  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Nimra Baig'
    AND srv.name IN (
      -- Nail tech: gel, acrylic, nail art, pedicure
      'Regular manicure',
      'Regular pedicure',
      'Deluxe / spa manicure',
      'Deluxe / spa pedicure',
      'Nail polish change (hands)',
      'Nail polish change (feet)',
      'Gel polish (hands)',
      'Gel polish (feet)',
      'Acrylic nail extensions (full set)',
      'Gel nail extensions (full set)',
      'Nail art (per nail add-on)',
      'Nail art (full set, detailed)',
      'Nail removal (extensions)'
    );

  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Hina Shoukat'
    AND srv.name IN (
      -- Skincare: facials, dermaplaning, microdermabrasion, threading
      'Basic fruit facial',
      'Whitening facial',
      'Brightening / glow facial',
      'Gold facial',
      'Diamond facial',
      'Hydra facial',
      'Oxygen facial',
      'Anti-aging / collagen facial',
      'Acne-control facial',
      'Microdermabrasion',
      'Dermaplaning',
      'Charcoal detox facial',
      'Back facial',
      'Eyebrow threading',
      'Upper lip threading',
      'Full face threading'
    );

  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Ushna Riaz'
    AND srv.name IN (
      -- Junior stylist: wash, blow-dry, basic threading/waxing, prep
      'Basic hair wash + conditioner',
      'Blow-dry (short hair)',
      'Blow-dry (medium hair)',
      'Blow-dry (long hair)',
      'Head massage (oil)',
      'Eyebrow threading',
      'Upper lip threading'
    );

  INSERT INTO public.staff_skills (staff_id, service_id)
  SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
  WHERE s.business_id = v_business_id
    AND s.name = 'Zoya Ahmed'
    AND srv.name IN (
      -- Massage therapist: body massage, polish, back facials
      'Body massage (relaxation, 30 min)',
      'Body massage (full, 60 min)',
      'Body polish / scrub',
      'Body wrap / detox',
      'Foot massage / reflexology',
      'Back facial'
    );

  -- (Saba Ilyas — receptionist, no service skills by design)

  -- Note: verification report is in a separate SELECT below, OUTSIDE
  -- the DO block, because PL/pgSQL DO blocks can't return rows.

END $$;

-- =====================================================================
-- 7. Verification report (run separately after the DO block above)
-- =====================================================================
SELECT
  (SELECT COUNT(*) FROM public.businesses
     WHERE name = 'FABS Beauty Lounge & Salon') AS business_rows,
  (SELECT COUNT(*) FROM public.business_hours
     WHERE business_id IN
       (SELECT id FROM public.businesses
        WHERE name = 'FABS Beauty Lounge & Salon')) AS hours_rows,
  (SELECT COUNT(*) FROM public.staff
     WHERE business_id IN
       (SELECT id FROM public.businesses
        WHERE name = 'FABS Beauty Lounge & Salon')) AS staff_rows,
  (SELECT COUNT(*) FROM public.services
     WHERE business_id IN
       (SELECT id FROM public.businesses
        WHERE name = 'FABS Beauty Lounge & Salon')) AS service_rows,
  (SELECT COUNT(*) FROM public.staff_skills sk
       JOIN public.staff s ON s.id = sk.staff_id
       JOIN public.businesses b ON b.id = s.business_id
     WHERE b.name = 'FABS Beauty Lounge & Salon') AS skills_rows;
