-- =====================================================================
-- SalonIQ — WhatsApp Live Session Router
-- Run this AFTER 04_auth_trigger.sql
-- =====================================================================

-- 1. Create the session switchboard table
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL UNIQUE,       -- Raw sender number from WhatsApp webhook
  business_id  uuid REFERENCES public.businesses(id) ON DELETE SET NULL, -- The tenant context
  context_mode text NOT NULL DEFAULT 'customer' CHECK (context_mode IN ('customer', 'owner', 'staff')),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 2. Index for sub-millisecond lookups on every incoming webhook text
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_phone ON public.whatsapp_sessions(phone_number);

-- 3. Row Level Security Setup
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Business owners can view active sessions happening on their specific tenant channel
CREATE POLICY "Owners view active sessions for their business"
  ON public.whatsapp_sessions FOR SELECT
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

-- Superadmins have full root infrastructure access
CREATE POLICY "Superadmins full access - whatsapp_sessions"
  ON public.whatsapp_sessions FOR ALL
  USING (public.is_superadmin());