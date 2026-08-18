-- ---------------------------------------------------------------------------
-- Wave 18: Image Analysis (LLM-as-classifier pipeline)
--
-- Adds:
--   1. enum `image_classification` — three open-ended buckets:
--        service_reference           (photo is a reference for an appointment)
--        concern_or_complaint        (something went wrong / didn't expect)
--        unrelated_or_unclear        (memes, receipts, personal photos, ...)
--      Kept deliberately broad so we never need to add new categories as
--      the salon's service list changes or customers send novel content.
--   2. `image_analysis_logs` — every image classification row, with the
--      free-text fields (image_description, intent_notes, draft_reply)
--      as proper text columns so the concern bucket is easy to audit.
--   3. `confidence` enum — high | medium | low, mirroring the model's
--      self-reported confidence so we can filter low-quality rows later.
--   4. Indexes for the hot audit path: list escalations (concern bucket)
--      per business, and per-conversation history.
--   5. RLS — service role bypasses for backend writes; no public read.
-- ---------------------------------------------------------------------------

-- 1. Enums ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.image_classification AS ENUM (
    'service_reference',
    'concern_or_complaint',
    'unrelated_or_unclear'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.image_confidence AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Logs table --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.image_analysis_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id     uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  customer_id         uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  message_id          text,                              -- WhatsApp message id (text)
  classification      public.image_classification NOT NULL,
  image_description   text,                              -- free text: what the model saw
  intent_notes        text,                              -- free text: why this bucket
  confidence          public.image_confidence NOT NULL DEFAULT 'low',
  escalate_to_human   boolean NOT NULL DEFAULT false,
  safety_net_triggered boolean NOT NULL DEFAULT false,   -- true when the
                                                          -- health/injury/reaction/
                                                          -- pain-adjacent override
                                                          -- flipped the decision
  draft_reply         text NOT NULL,                     -- text we actually sent
  llm_model           text,                              -- 'minimax-m3' / 'gemini-2.5-flash-lite'
  llm_provider        text,                              -- 'minimax' / 'gemini'
  latency_ms          integer,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes ----------------------------------------------------------------
--   Audit hot path: "list all concern_or_complaint rows for this business
--   in the last N days". The (business_id, classification, created_at)
--   composite index covers this in one scan.
CREATE INDEX IF NOT EXISTS idx_image_logs_business_class_created
  ON public.image_analysis_logs(business_id, classification, created_at DESC);

--   Per-conversation history for the inbox / debug panels.
CREATE INDEX IF NOT EXISTS idx_image_logs_conversation
  ON public.image_analysis_logs(conversation_id, created_at DESC);

--   Escalation audit: list all rows that triggered human handoff.
CREATE INDEX IF NOT EXISTS idx_image_logs_escalations
  ON public.image_analysis_logs(business_id, created_at DESC)
  WHERE escalate_to_human = true;

-- 4. RLS --------------------------------------------------------------------
ALTER TABLE public.image_analysis_logs ENABLE ROW LEVEL SECURITY;

-- Service role (backend) bypasses RLS automatically — no explicit policy
-- needed for backend writes. We DO want salon owners to be able to read
-- their own rows when triaging the Inbox / Escalations tabs.
--
-- Mirrors the pattern in 01_schema.sql / 02_migration_v1_1.sql: the
-- owner_id column on businesses scopes the SELECT, and the superadmin
-- read uses the existing public.is_superadmin() helper (defined in
-- 03_rls_policies.sql) — NOT a column name like `is_superadmin` on
-- profiles, which doesn't exist in this project.
DROP POLICY IF EXISTS image_logs_owner_read ON public.image_analysis_logs;
CREATE POLICY image_logs_owner_read ON public.image_analysis_logs
  FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM public.businesses
      WHERE owner_id = auth.uid()
    )
  );

-- Superadmin can read everything for the Escalations drill-in.
DROP POLICY IF EXISTS image_logs_superadmin_read ON public.image_analysis_logs;
CREATE POLICY image_logs_superadmin_read ON public.image_analysis_logs
  FOR SELECT
  USING (public.is_superadmin());

-- 5. Schema notes -----------------------------------------------------------
-- The `messages` table is intentionally LEFT UNTOUCHED in this migration.
-- The image turns are written into `messages` by the same `saveMessage()`
-- helper the text path uses, with `sender_type='customer'` and `content`
-- set to a short marker like "[Image — see image_analysis_logs]". The
-- free-text content (image_description, intent_notes, draft_reply) lives
-- ONLY in image_analysis_logs so the chat thread stays uncluttered while
-- the audit trail remains complete.
-- ---------------------------------------------------------------------------