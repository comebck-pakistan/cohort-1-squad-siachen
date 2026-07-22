-- Halo migration 12 — conversation state table + lifecycle columns
-- Applied to Supabase: 2026-07-22
-- RLS enabled on conversation_state (service role bypasses for backend writes).

CREATE TABLE IF NOT EXISTS conversation_state (
    conversation_id   UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    current_intent    TEXT,
    service_interest  TEXT,
    preferred_date    TEXT,
    preferred_time    TEXT,
    customer_name     TEXT,
    customer_phone    TEXT,
    last_customer_msg TEXT,
    last_agent_msg    TEXT,
    status            TEXT NOT NULL DEFAULT 'active',
    outcome           TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_state_business
    ON conversation_state(business_id, updated_at DESC);

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS resolved_at       TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS resolution_reason TEXT        NULL;

CREATE INDEX IF NOT EXISTS idx_conv_resolved
    ON conversations(resolved_at) WHERE resolved_at IS NOT NULL;
