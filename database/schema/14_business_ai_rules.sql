-- =====================================================================
-- Business AI Rules — owner-customized rules + triggers for the AI agent.
--
-- Adds one nullable JSONB column to `businesses` that stores the full
-- Agent Rules panel state (TenantAIRules.tsx). Backward-compatible:
-- existing rows get NULL → the API returns sensible defaults until
-- the owner saves their first rule.
--
-- Schema:
--   {
--     "rules": string[],            -- custom rules the owner has written
--     "triggers": {                 -- which rule categories are active
--       "discounts": bool,
--       "late": bool,
--       "custom": bool
--     },
--     "discountMode": "decline"|"promo",
--     "latePolicy": string          -- free-text explanation
--   }
-- =====================================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_rules JSONB;
