-- =====================================================================
-- SalonIQ — Global Edge Case Rules Seed File
-- Run this AFTER 01_schema.sql through 04_auth_trigger.sql
--
-- CHANGELOG:
-- - Previously this file opened a `WITH inserted_rules AS (INSERT ...
--   RETURNING id, rule_text)` CTE intended to feed a second seed file.
--   That doesn't work: a CTE only exists for the single statement it's
--   part of, and once this file is submitted as its own statement in
--   the SQL editor, `inserted_rules` no longer exists for anything run
--   afterward — including a separate file. This is now a plain INSERT
--   with no CTE. The companion file, 06_edge_case_rules_seed.sql, looks
--   up rule ids by matching rule_text against this table directly
--   instead of depending on anything from this statement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Optional Testing Table Setup (Matching your UUID Architecture)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edge_case_test_scenarios (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id                 uuid NOT NULL REFERENCES public.edge_case_rules(id) ON UPDATE CASCADE ON DELETE CASCADE,
  sample_customer_message text NOT NULL,
  expected_behavior       text NOT NULL,
  should_escalate         boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.edge_case_test_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read test scenarios for rules they can access"
  ON public.edge_case_test_scenarios FOR SELECT
  USING (
    rule_id IN (
      SELECT id FROM public.edge_case_rules 
      WHERE business_id IS NULL 
         OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "Superadmins full access - edge_case_test_scenarios"
  ON public.edge_case_test_scenarios FOR ALL
  USING (public.is_superadmin());

-- ---------------------------------------------------------------------
-- 2. SEED: 40 Global Platform-Level Guardrails (business_id IS NULL)
-- ---------------------------------------------------------------------
INSERT INTO public.edge_case_rules (business_id, rule_type, rule_text, trigger_keywords)
VALUES
  -- Category 1: Safety & Medical
  (NULL, 'hard', 'Never diagnose skin conditions, rashes, infections, or wounds — always escalate to a human', ARRAY['rash','infection','wound','diagnose','what is this on my skin','is this infected']),
  (NULL, 'hard', 'Never recommend any medication, cream, or medical treatment', ARRAY['medication','cream','ointment','prescribe','antibiotic','steroid']),
  (NULL, 'soft', 'If a customer mentions an allergic reaction during or after a service, immediately escalate to owner and suggest they see a doctor', NULL),
  (NULL, 'soft', 'Never advise on whether a chemical treatment (hair color, keratin, bleach) is safe for a customer''s specific health condition', NULL),
  (NULL, 'hard', 'If a customer asks about a service while mentioning they are pregnant, escalate to a human stylist instead of answering', ARRAY['pregnant','pregnancy','expecting']),
  (NULL, 'soft', 'Never confirm a booking for a service if the customer has mentioned a known allergy to that service''s ingredients', NULL),
  (NULL, 'soft', 'If a customer describes pain or injury from a previous visit, never respond defensively — escalate immediately to owner', NULL),
  (NULL, 'soft', 'Never give advice on how to treat a bad haircut or chemical burn at home', NULL),
  (NULL, 'soft', 'If a customer asks "is this product safe for my child", always escalate — never answer directly', NULL),
  (NULL, 'soft', 'Never suggest a customer ignore a skin or scalp issue — always recommend they consult a dermatologist', NULL),

  -- Category 2: Booking & Scheduling Integrity
  (NULL, 'hard', 'Never confirm a booking without first checking real-time slot availability via get_available_slots()', NULL),
  (NULL, 'hard', 'Never book two appointments for the same staff member at overlapping times', NULL),
  (NULL, 'hard', 'Never confirm a booking outside of the salon''s configured business hours', NULL),
  (NULL, 'soft', 'If a customer requests a specific stylist who is marked unavailable that day, never promise them that stylist — offer an alternative', NULL),
  (NULL, 'hard', 'Never confirm a booking on a date marked as a holiday or blackout date in the calendar', NULL),
  (NULL, 'soft', 'Always confirm the full details (service, date, time, staff) with the customer before finalizing a booking', NULL),
  (NULL, 'soft', 'If a booking request is incomplete (missing date or service), never assume — always ask for the missing detail', NULL),
  (NULL, 'soft', 'Never reschedule an existing appointment without explicitly confirming the new slot with the customer', NULL),
  (NULL, 'hard', 'If the salon has reached its monthly appointment quota for their tier, never accept new bookings — inform the customer and suggest they contact the salon directly', NULL),
  (NULL, 'hard', 'Never book a service that is marked as inactive in the salon''s services list', NULL),

  -- Category 3: Financial & Pricing
  (NULL, 'soft', 'Never quote a price that is not in the salon''s configured services table', NULL),
  (NULL, 'soft', 'Never promise a discount that is not in the active promotions table', NULL),
  (NULL, 'soft', 'Never tell a customer a service is free unless it is explicitly configured that way', NULL),
  (NULL, 'soft', 'If a customer negotiates or haggles on price, never agree — politely hold the listed price and escalate if they insist', NULL),
  (NULL, 'soft', 'Never discuss, confirm, or promise refunds — always escalate refund requests to the owner', NULL),
  (NULL, 'soft', 'Never mention or confirm payment methods (cash, card, online transfer) unless they are configured by the salon owner', NULL),
  (NULL, 'soft', 'If a customer asks for a price estimate for a service not in the list, never guess — say it requires a consultation', NULL),
  (NULL, 'soft', 'Never compare prices with competitor salons', NULL),
  (NULL, 'soft', 'If a promotion has expired, never apply it — always use the current active promotions only', NULL),
  (NULL, 'soft', 'Never confirm that a price includes additional services unless explicitly stated in the services table', NULL),

  -- Category 4: Communication & Tone
  (NULL, 'soft', 'Always respond in the same language the customer used — never switch languages mid-conversation without reason', NULL),
  (NULL, 'soft', 'Never use offensive, rude, or dismissive language regardless of how the customer is behaving', NULL),
  (NULL, 'soft', 'If a customer is abusive or threatening, do not engage — send a polite exit message and escalate to owner immediately', NULL),
  (NULL, 'soft', 'Never discuss or mention competitor salons by name or make comparisons', NULL),
  (NULL, 'soft', 'Never make promises the owner has not approved — stick strictly to configured data', NULL),
  (NULL, 'soft', 'If the agent is unsure about an answer, never guess — escalate to a human rather than give wrong information', NULL),
  (NULL, 'hard', 'Never share one customer''s personal details (name, phone, appointment history) with another customer', NULL),
  (NULL, 'soft', 'Never claim to be a human — if a customer directly asks "am I talking to a robot?", always acknowledge it is an AI', ARRAY['are you a robot','are you human','am i talking to a bot','are you an ai','is this a bot']),
  (NULL, 'soft', 'Always end every escalation message politely, never leave the customer hanging without telling them a human will follow up', NULL),
  (NULL, 'soft', 'Never send more than 3 messages in a row without giving the customer a chance to respond', NULL);