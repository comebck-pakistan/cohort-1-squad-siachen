-- =====================================================================
-- 19_predefined_rules.sql
--
-- Wave 9 — replace the freeform ai_rules JSONB blob with a typed
-- toggle system. Owners enable/disable predefined rules and escalation
-- triggers, but cannot edit the rule text itself.
--
-- Replaces:    public.businesses.ai_rules (14_business_ai_rules.sql)
-- Adds:        public.business_rule
--              public.business_escalation_trigger
--
-- Predefined rule vocabulary (mirrored in backend/src/lib/predefined-rules.ts):
--   discount_decline      — polite decline on any discount mention
--   discount_promo        — offer WELCOME10 once per conversation
--   late_arrival_15min    — 15-minute late-arrival tolerance
--   late_arrival_30min    — 30-minute late-arrival tolerance
--   refund_48h            — only honor refunds within 48h of service
--   refund_full           — full refund, no questions
--   no_double_booking     — never book two customers with same stylist at overlapping times
--   min_24h_advance       — reject bookings less than 24h in advance
--   no_medical_advice     — never give medical/skin/health advice
--
-- Predefined escalation trigger vocabulary:
--   complaint             — customer mentions bad experience / unhappy
--   ownerNumber           — customer asks for owner's personal number
--   twoMisunderstands     — bot didn't understand 2+ times in a row
--   refund                — customer mentions refund / money back
--   afterHours            — booking requested outside operating hours
--
-- Migration applied to Supabase: <YYYY-MM-DD>
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Drop the old freeform JSONB blob. The Custom Salon Rules only
--    "worked" by accident (the AI prompt read the JSON as a single
--    string and the model sometimes parsed prose-shaped entries). Drop
--    clean — no legacy archive. See Wave 9 audit (2026-08-11).
-- ---------------------------------------------------------------------
ALTER TABLE public.businesses
  DROP COLUMN IF EXISTS ai_rules;

-- ---------------------------------------------------------------------
-- 2. business_rule — per-salon toggle of predefined rules.
--    The rule_key vocabulary is owned by the platform; the backend
--    validates incoming rule_keys against
--    backend/src/lib/predefined-rules.ts before any write.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_rule (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  rule_key    TEXT  NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  enabled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, rule_key)
);

-- Index for the common read: "all enabled rules for this salon".
-- Partial index keeps it small — disabled rows are rare and not queried.
CREATE INDEX IF NOT EXISTS idx_business_rule_enabled
  ON public.business_rule (business_id)
  WHERE enabled = TRUE;

COMMENT ON TABLE  public.business_rule IS
  'Per-salon toggle of predefined AI agent rules. rule_key vocabulary is platform-defined in backend/src/lib/predefined-rules.ts.';
COMMENT ON COLUMN public.business_rule.rule_key IS
  'One of the predefined keys (e.g. discount_decline, late_arrival_15min, no_medical_advice). Adding a new rule requires a backend deployment.';

-- ---------------------------------------------------------------------
-- 3. business_escalation_trigger — per-salon toggle of escalation triggers.
--    Same pattern as business_rule but for the 5 Human Escalation Triggers
--    that the previous freeform UI had no persistence for.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_escalation_trigger (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  trigger_key TEXT  NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (business_id, trigger_key)
);

CREATE INDEX IF NOT EXISTS idx_business_escalation_trigger_enabled
  ON public.business_escalation_trigger (business_id)
  WHERE enabled = TRUE;

COMMENT ON TABLE  public.business_escalation_trigger IS
  'Per-salon toggle of escalation triggers. trigger_key vocabulary: complaint, ownerNumber, twoMisunderstands, refund, afterHours.';
COMMENT ON COLUMN public.business_escalation_trigger.trigger_key IS
  'One of the 5 predefined trigger keys. Adding a new trigger requires a backend deployment.';

-- ---------------------------------------------------------------------
-- 4. RLS — owners can read/write their own rows. Follows the pattern
--    used by similar per-salon tables (services, business_hours, etc.).
--    service_role bypasses RLS, so the backend uses getSupabase() with
--    the service key for all writes.
-- ---------------------------------------------------------------------
ALTER TABLE public.business_rule              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_escalation_trigger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_rule_owner_rw" ON public.business_rule
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_rule.business_id AND b.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_rule.business_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "business_escalation_trigger_owner_rw" ON public.business_escalation_trigger
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_escalation_trigger.business_id AND b.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_escalation_trigger.business_id AND b.owner_id = auth.uid()
    )
  );
