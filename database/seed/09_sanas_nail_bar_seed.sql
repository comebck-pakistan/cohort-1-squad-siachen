-- =====================================================================
-- Sana's Nail Bar — Demo Seed
-- =====================================================================
-- Targeted seed for the user's actual registered business
-- (business_type = 'nails', so all services are nail-focused).
-- Idempotent. Apply migration 13 columns first so role/working_days/
-- category work, then insert demo data.
--
-- ID scheme (all valid hex UUIDs):
--   f1xxxxxx  = staff       (4 rows)
--   f2xxxxxx  = services    (10 rows)
--   f3xxxxxx  = customers   (8 rows)
--   f4xxxxxx  = conversations (4 rows)
--   f5xxxxxx  = messages    (10 rows)
--   f6xxxxxx  = escalations (1 row)
-- =====================================================================

DO $$
DECLARE
  v_business_id uuid := 'eadf9f12-1136-4418-ad1d-4a0686fa294f';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
      WHERE id = v_business_id AND name = 'Sana''s Nail Bar'
  ) THEN
    RAISE EXCEPTION 'Sana''s Nail Bar row not found at id %. Aborting.', v_business_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Apply migration 13 + 14 columns (idempotent — no-op if already applied)
-- ---------------------------------------------------------------------
ALTER TABLE public.services    ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.staff       ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE public.staff       ADD COLUMN IF NOT EXISTS working_days TEXT;
ALTER TABLE public.businesses  ADD COLUMN IF NOT EXISTS appointment_buffer_min INT NOT NULL DEFAULT 15;
ALTER TABLE public.businesses  ADD COLUMN IF NOT EXISTS ai_rules JSONB;
CREATE INDEX IF NOT EXISTS idx_services_category ON public.services(category) WHERE category IS NOT NULL;

-- ---------------------------------------------------------------------
-- 1. Update the business row: AI rules + buffer (drives Agent Rules tab)
-- ---------------------------------------------------------------------
UPDATE public.businesses
   SET ai_rules = jsonb_build_object(
       'rules', jsonb_build_array(
         'Always confirm which nail service (manicure / pedicure / extensions / nail art) before quoting a price',
         'For gel and acrylic services, ask about length — short, medium, or long',
         'Mention Saturday 15% off on gel manicures for new clients',
         'For nail art, ask how many nails the client wants decorated (full set vs accent nails)',
         'If a client asks about removal without a new service, recommend getting it done at the salon to avoid damage'
       ),
       'triggers', jsonb_build_object(
         'discounts', true,
         'late',      true,
         'custom',    true
       ),
       'discountMode', 'promo',
       'latePolicy',  'If a client is more than 10 minutes late, offer to hold the slot for 5 more minutes. After 15 minutes, the appointment is released and the slot is offered to the next walk-in.'
     ),
       appointment_buffer_min = 15
 WHERE id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f';

-- ---------------------------------------------------------------------
-- 2. Staff (4 nail technicians)
-- ---------------------------------------------------------------------
INSERT INTO public.staff (id, business_id, name, phone, role, working_days, is_active, created_at) VALUES
  ('f1000001-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Sana Malik',      '+923311111111', 'Owner / Senior Nail Tech', 'mon,tue,wed,thu,fri,sat', true, NOW() - INTERVAL '90 days'),
  ('f1000002-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Hira Khan',       '+923312222222', 'Nail Technician',           'tue,wed,thu,fri,sat',     true, NOW() - INTERVAL '75 days'),
  ('f1000003-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Ayesha Siddiqui', '+923313333333', 'Nail Technician',           'mon,tue,wed,thu,fri',     true, NOW() - INTERVAL '60 days'),
  ('f1000004-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Maira Aslam',     '+923314444444', 'Junior Nail Tech',          'wed,thu,fri,sat,sun',     true, NOW() - INTERVAL '30 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Services (10 nail-focused services)
-- ---------------------------------------------------------------------
INSERT INTO public.services (id, business_id, name, duration_minutes, staff_required, price, is_active, category, created_at) VALUES
  ('f2000001-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Classic Manicure',         45, 1,  1500, true, 'Nails', NOW() - INTERVAL '90 days'),
  ('f2000002-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Gel Manicure',             60, 1,  2500, true, 'Nails', NOW() - INTERVAL '88 days'),
  ('f2000003-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Classic Pedicure',         60, 1,  2000, true, 'Nails', NOW() - INTERVAL '85 days'),
  ('f2000004-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Gel Pedicure',             75, 1,  3200, true, 'Nails', NOW() - INTERVAL '80 days'),
  ('f2000005-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Acrylic Full Set',         90, 1,  4500, true, 'Nails', NOW() - INTERVAL '70 days'),
  ('f2000006-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Gel Extensions Full Set',  90, 1,  5500, true, 'Nails', NOW() - INTERVAL '65 days'),
  ('f2000007-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Nail Art (per nail)',      15, 1,  300,  true, 'Nails', NOW() - INTERVAL '60 days'),
  ('f2000008-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Nail Art Full Set',        60, 1,  2000, true, 'Nails', NOW() - INTERVAL '55 days'),
  ('f2000009-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Nail Removal',             30, 1,  800,  true, 'Other', NOW() - INTERVAL '50 days'),
  ('f200000a-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'Bridal Nail Package',     120, 1,  8500, true, 'Other', NOW() - INTERVAL '40 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. Staff skills (Sana does everything; Hira/Ayesha/Maira specialized)
-- ---------------------------------------------------------------------
INSERT INTO public.staff_skills (staff_id, service_id)
SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
 WHERE s.business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f'
   AND s.name = 'Sana Malik'
ON CONFLICT DO NOTHING;

INSERT INTO public.staff_skills (staff_id, service_id)
SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
 WHERE s.business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f'
   AND s.name = 'Hira Khan'
   AND srv.name IN ('Classic Manicure', 'Gel Manicure', 'Classic Pedicure', 'Gel Pedicure', 'Nail Art (per nail)', 'Nail Art Full Set', 'Bridal Nail Package')
ON CONFLICT DO NOTHING;

INSERT INTO public.staff_skills (staff_id, service_id)
SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
 WHERE s.business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f'
   AND s.name = 'Ayesha Siddiqui'
   AND srv.name IN ('Acrylic Full Set', 'Gel Extensions Full Set', 'Nail Removal', 'Bridal Nail Package')
ON CONFLICT DO NOTHING;

INSERT INTO public.staff_skills (staff_id, service_id)
SELECT s.id, srv.id
  FROM public.staff s
  JOIN public.services srv ON srv.business_id = s.business_id
 WHERE s.business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f'
   AND s.name = 'Maira Aslam'
   AND srv.name IN ('Classic Manicure', 'Classic Pedicure', 'Nail Art (per nail)')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. Customers (realistic Pakistani names; one row per unique phone)
-- ---------------------------------------------------------------------
INSERT INTO public.customers (id, phone, name, created_at) VALUES
  ('f3000001-0000-4000-8000-000000000001', '+923211234567', 'Fatima Riaz',      NOW() - INTERVAL '12 days'),
  ('f3000002-0000-4000-8000-000000000001', '+923151234567', 'Maham Tariq',      NOW() - INTERVAL '8 days'),
  ('f3000003-0000-4000-8000-000000000001', '+923331234567', 'Zainab Hussain',   NOW() - INTERVAL '5 days'),
  ('f3000004-0000-4000-8000-000000000001', '+923451234567', 'Aiman Shah',       NOW() - INTERVAL '3 days'),
  ('f3000005-0000-4000-8000-000000000001', '+923001234568', 'Hina Malik',       NOW() - INTERVAL '2 days'),
  ('f3000006-0000-4000-8000-000000000001', '+923221234567', 'Saba Qureshi',     NOW() - INTERVAL '1 day'),
  ('f3000007-0000-4000-8000-000000000001', '+923111234567', 'Iqra Yousuf',      NOW() - INTERVAL '6 hours'),
  ('f3000008-0000-4000-8000-000000000001', '+923181234567', 'Arooj Fatima',     NOW() - INTERVAL '4 hours')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. New conversations (mix of active + escalated)
--    Existing 3 conversations in Sana's Nail Bar stay as-is.
-- ---------------------------------------------------------------------
INSERT INTO public.conversations (id, business_id, customer_id, status, last_message_at, created_at) VALUES
  ('f4000001-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'f3000001-0000-4000-8000-000000000001', 'active',    NOW() - INTERVAL '8 minutes',  NOW() - INTERVAL '12 days'),
  ('f4000002-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'f3000002-0000-4000-8000-000000000001', 'active',    NOW() - INTERVAL '2 minutes',  NOW() - INTERVAL '8 days'),
  ('f4000003-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'f3000003-0000-4000-8000-000000000001', 'escalated', NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '5 days'),
  ('f4000004-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f', 'f3000006-0000-4000-8000-000000000001', 'active',    NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 7. Conversation state
-- ---------------------------------------------------------------------
INSERT INTO public.conversation_state (
  conversation_id, business_id, current_intent, service_interest,
  last_customer_msg, last_agent_msg, status, outcome, updated_at
) VALUES
  ('f4000001-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f',
   'booking_request', 'Gel pedicure',
   'Can I book gel pedicure for Saturday 4pm?',
   'Sure! Saturday at 4pm gel pedicure with Hira — should I confirm?',
   'active', NULL, NOW() - INTERVAL '8 minutes'),

  ('f4000002-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f',
   'price_inquiry', 'Bridal nail package',
   'What''s the price for bridal nail package?',
   'Our Bridal Nail Package is PKR 8,500 and takes about 2 hours. Want me to share what''s included?',
   'active', NULL, NOW() - INTERVAL '2 minutes'),

  ('f4000003-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f',
   'escalation', NULL,
   'I came yesterday and my gel chipped after 2 hours. I want a refund.',
   'I''m really sorry to hear that. Let me connect you with Sana directly — she''ll make this right.',
   'escalated', NULL, NOW() - INTERVAL '25 minutes'),

  ('f4000004-0000-4000-8000-000000000001', 'eadf9f12-1136-4418-ad1d-4a0686fa294f',
   'booking_request', 'Any nail service',
   'Do you have any slot today?',
   'Today we have 6pm and 7:30pm available. Which works for you?',
   'active', NULL, NOW() - INTERVAL '15 minutes')
ON CONFLICT (conversation_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 8. Messages
-- ---------------------------------------------------------------------
INSERT INTO public.messages (id, conversation_id, sender_type, content, created_at) VALUES
  ('f5000001-0000-4000-8000-000000000001', 'f4000001-0000-4000-8000-000000000001', 'customer', 'Hi!',                                                  NOW() - INTERVAL '15 minutes'),
  ('f5000002-0000-4000-8000-000000000001', 'f4000001-0000-4000-8000-000000000001', 'agent',    'Hello! Welcome to Sana''s Nail Bar. How can I help?',   NOW() - INTERVAL '14 minutes'),
  ('f5000003-0000-4000-8000-000000000001', 'f4000001-0000-4000-8000-000000000001', 'customer', 'Can I book gel pedicure for Saturday 4pm?',              NOW() - INTERVAL '12 minutes'),
  ('f5000004-0000-4000-8000-000000000001', 'f4000001-0000-4000-8000-000000000001', 'agent',    'Sure! Saturday at 4pm gel pedicure with Hira — confirm?',NOW() - INTERVAL '8 minutes'),

  ('f5000005-0000-4000-8000-000000000001', 'f4000002-0000-4000-8000-000000000001', 'customer', 'What''s the price for bridal nail package?',              NOW() - INTERVAL '3 minutes'),
  ('f5000006-0000-4000-8000-000000000001', 'f4000002-0000-4000-8000-000000000001', 'agent',    'Our Bridal Nail Package is PKR 8,500 and takes about 2 hours.', NOW() - INTERVAL '2 minutes'),

  ('f5000007-0000-4000-8000-000000000001', 'f4000003-0000-4000-8000-000000000001', 'customer', 'I came yesterday and my gel chipped after 2 hours. I want a refund.', NOW() - INTERVAL '30 minutes'),
  ('f5000008-0000-4000-8000-000000000001', 'f4000003-0000-4000-8000-000000000001', 'agent',    'I''m really sorry to hear that. Let me connect you with Sana directly.', NOW() - INTERVAL '25 minutes'),

  ('f5000009-0000-4000-8000-000000000001', 'f4000004-0000-4000-8000-000000000001', 'customer', 'Do you have any slot today?',                            NOW() - INTERVAL '20 minutes'),
  ('f500000a-0000-4000-8000-000000000001', 'f4000004-0000-4000-8000-000000000001', 'agent',    'Today we have 6pm and 7:30pm available. Which works for you?', NOW() - INTERVAL '15 minutes')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 9. Escalation events
-- ---------------------------------------------------------------------
INSERT INTO public.escalation_events (id, conversation_id, reason, ai_draft_response, resolved, created_at) VALUES
  ('f6000001-0000-4000-8000-000000000001',
   'f4000003-0000-4000-8000-000000000001',
   'hard_rule:refund_request_after_service',
   'Hi, I''m so sorry your gel didn''t hold up. I''d like to offer you a complimentary redo this week — when works for you? — Sana',
   false, NOW() - INTERVAL '25 minutes')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 10. Verification
-- ---------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM public.staff       WHERE business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f') AS staff,
  (SELECT COUNT(*) FROM public.services    WHERE business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f') AS services,
  (SELECT COUNT(*) FROM public.staff_skills
     WHERE staff_id IN (SELECT id FROM public.staff WHERE business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f')
  ) AS skills,
  (SELECT COUNT(*) FROM public.conversations WHERE business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f') AS conversations,
  (SELECT COUNT(*) FROM public.conversation_state WHERE business_id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f') AS conv_states,
  (SELECT COUNT(*) FROM public.messages WHERE conversation_id::text LIKE 'f4%') AS messages,
  (SELECT COUNT(*) FROM public.escalation_events WHERE id::text LIKE 'f6%') AS escalations,
  (SELECT ai_rules IS NOT NULL FROM public.businesses WHERE id = 'eadf9f12-1136-4418-ad1d-4a0686fa294f') AS ai_rules_set;
