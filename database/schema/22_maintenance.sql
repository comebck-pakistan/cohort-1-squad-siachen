-- ---------------------------------------------------------------------------
-- Maintenance System Mode
--
-- Persistent operational kill switch for the AI receptionist. Allows
-- superadmins to temporarily disable bot processing (LLM, booking,
-- cancellations, customer-driven DB mutations) at global or per-salon
-- scope without restarting services or disconnecting WhatsApp clients.
--
-- Adds:
--   1. maintenance_windows            — the persistent state table
--   2. maintenance_audit_log          — who/when for every state change
--   3. maintenance_response_cooldown  — per-(salon, customer) dedup table
--
-- Runtime precedence (enforced in resolver.ts):
--   - salon row wins over global row
--   - rows with ends_at <= now() are filtered out at lookup time
--     (so the cleanup job is only an optimization, never the source of truth)
--   - one-open-window invariant via partial unique indexes
-- ---------------------------------------------------------------------------

-- 1. maintenance_windows --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('global', 'salon')),
  salon_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  reason text,
  message text NOT NULL,
  cooldown_minutes integer NOT NULL DEFAULT 30
    CHECK (cooldown_minutes BETWEEN 0 AND 1440),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  source text NOT NULL DEFAULT 'admin'
    CHECK (source IN ('admin', 'system')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by text,
  CONSTRAINT maintenance_windows_scope_consistency CHECK (
    (scope = 'global' AND salon_id IS NULL) OR
    (scope = 'salon'  AND salon_id IS NOT NULL)
  )
);

-- Only one open global window at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_windows_one_open_global
  ON public.maintenance_windows (scope)
  WHERE scope = 'global' AND enabled = true;

-- Only one open window per salon at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_windows_one_open_salon
  ON public.maintenance_windows (salon_id)
  WHERE scope = 'salon' AND enabled = true AND salon_id IS NOT NULL;

-- Hot-path lookup index for the resolver
CREATE INDEX IF NOT EXISTS idx_maintenance_windows_lookup
  ON public.maintenance_windows (enabled, scope, salon_id, starts_at DESC)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_maintenance_windows_salon_history
  ON public.maintenance_windows (salon_id, starts_at DESC)
  WHERE salon_id IS NOT NULL;

-- 2. maintenance_audit_log ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id uuid REFERENCES public.maintenance_windows(id) ON DELETE SET NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'enabled', 'disabled', 'updated', 'expired',
    'lookup_failed', 'response_sent', 'response_suppressed'
  )),
  actor_id text,
  actor_type text NOT NULL CHECK (actor_type IN ('superadmin', 'system')),
  scope text CHECK (scope IN ('global', 'salon')),
  affected_salons uuid[],
  previous_state jsonb,
  new_state jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_audit_log_created
  ON public.maintenance_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_audit_log_window
  ON public.maintenance_audit_log (window_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_audit_log_business
  ON public.maintenance_audit_log (business_id, created_at DESC)
  WHERE business_id IS NOT NULL;

-- 3. maintenance_response_cooldown ----------------------------------------
-- Tracks when each (salon, customer) pair last received a maintenance reply,
-- so we can suppress duplicate maintenance responses within the cooldown
-- window without spamming the customer's WhatsApp.
--
-- Separate table (not a column on customers) because:
--   - this is a maintenance-specific dedup marker, not a customer property
--   - reads are "is this pair in cooldown right now" — needs fast single-row lookup
--   - cleanup is a single bulk DELETE WHERE last_sent_at < threshold
CREATE TABLE IF NOT EXISTS public.maintenance_response_cooldown (
  salon_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_phone text NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  last_window_id uuid REFERENCES public.maintenance_windows(id) ON DELETE SET NULL,
  PRIMARY KEY (salon_id, customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_response_cooldown_last_sent
  ON public.maintenance_response_cooldown (last_sent_at);

-- Row Level Security -------------------------------------------------------
-- Backend uses the service-role client which bypasses RLS automatically;
-- these policies are belt-and-braces in case a non-service-role client
-- is added in the future.

ALTER TABLE public.maintenance_windows          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_response_cooldown ENABLE ROW LEVEL SECURITY;

-- Superadmins can read windows and audit log; no client writes (backend only)
DROP POLICY IF EXISTS maintenance_windows_superadmin_read ON public.maintenance_windows;
CREATE POLICY maintenance_windows_superadmin_read
  ON public.maintenance_windows FOR SELECT
  USING (public.is_superadmin());

DROP POLICY IF EXISTS maintenance_audit_log_superadmin_read ON public.maintenance_audit_log;
CREATE POLICY maintenance_audit_log_superadmin_read
  ON public.maintenance_audit_log FOR SELECT
  USING (public.is_superadmin());

-- Cooldown table: no policies at all. Service-role only. Defense in depth.