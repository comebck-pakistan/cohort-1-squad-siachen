-- Halo migration 11 — conversation uniqueness protection
-- Applied to Supabase: 2026-07-22

-- Prevent two parallel "active" conversations per (business, customer).
-- Allows multiple resolved/historical conversations per customer over time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_conversation
    ON public.conversations (business_id, customer_id)
    WHERE status = 'active';
