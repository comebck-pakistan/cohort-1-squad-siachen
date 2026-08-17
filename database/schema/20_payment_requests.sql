-- ---------------------------------------------------------------------------
-- Wave 13: Payment Subscriptions (manual approval flow)
--
-- Adds:
--   1. plans             — catalog of what customers buy
--   2. payment_requests  — each submission from a customer (manual approval)
--   3. /alter businesses — subscription state columns
--   4. payment_audit_log — who/when for every state change
--   5. payment_request_indexes — hot-path queries
--
-- Storage bucket `payment-screenshots` is created manually in the Supabase
-- dashboard (private; only superadmin can read).
-- ---------------------------------------------------------------------------

-- 1. Plans table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  id text PRIMARY KEY,                 -- 'basic', 'pro'
  name text NOT NULL,
  monthly_price_pkr integer NOT NULL,
  description text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (id, name, monthly_price_pkr, description, features, sort_order) VALUES
  (
    'basic',
    'Basic',
    3000,
    'For solo stylists just getting started',
    '{"whatsapp_ai": true, "voice_notes": false, "escalations": true, "multi_staff": false}'::jsonb,
    1
  ),
  (
    'pro',
    'Pro',
    6000,
    'For growing salons with multiple staff',
    '{"whatsapp_ai": true, "voice_notes": true, "escalations": true, "multi_staff": true, "analytics": true}'::jsonb,
    2
  )
ON CONFLICT (id) DO NOTHING;

-- 2. Payment requests ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.plans(id),
  amount_pkr integer NOT NULL,
  payment_method text NOT NULL
    CHECK (payment_method IN ('jazzcash', 'easypaisa', 'bank_transfer')),
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL,
  customer_whatsapp text,
  transaction_reference text,
  screenshot_url text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status
  ON public.payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_business
  ON public.payment_requests(business_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at
  ON public.payment_requests(created_at DESC);

-- 3. Subscription state on businesses --------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS plan_id text
    REFERENCES public.plans(id) DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS next_billing_date timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial', 'active', 'expired', 'cancelled', 'pending_payment'));

-- Backfill existing trial businesses to the basic plan
UPDATE public.businesses
  SET plan_id = 'basic'
  WHERE plan_id IS NULL;

-- 4. Audit log -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid REFERENCES public.payment_requests(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_id uuid,
  actor_type text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_log_request
  ON public.payment_audit_log(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_business
  ON public.payment_audit_log(business_id);
