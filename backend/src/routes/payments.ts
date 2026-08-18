// ---------------------------------------------------------------------------
// Public payment endpoints — Wave 13.
//
// Endpoints (mounted at /api):
//   GET  /api/plans           — public list of active plans
//   POST /api/payments        — submit a payment request (with screenshot)
//   GET  /api/payments/:id    — check status (returns only if email matches)
//
// The submit endpoint accepts a JSON body with base64-encoded screenshot
// (same pattern as the deprecated public-onboarding route). The body is
// already JSON-parsed by express.json({ limit: '15mb' }) in index.ts.
//
// No auth — these are public-facing. The screenshot is uploaded to a
// private Supabase Storage bucket; only superadmin can view it via the
// signed-URL endpoint in superadmin-payments.ts.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { childLogger } from '../lib/logger';
import { createPaymentRequest } from '../lib/payments';

const router = Router();
const log = childLogger('payments-route');

// ─── GET /api/plans ───────────────────────────────────────────────────────

router.get('/plans', async (_req: Request, res: Response) => {
  const { data, error } = await getSupabase()
    .from('plans')
    .select('id, name, monthly_price_pkr, description, features, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    log.error({ err: error.message }, 'plans query failed');
    return res.status(500).json({ code: 'INTERNAL', message: 'Could not load plans' });
  }
  return res.json({ plans: data || [] });
});

// ─── POST /api/payments ───────────────────────────────────────────────────

interface PaymentBody {
  planId?: unknown;
  paymentMethod?: unknown;
  customerName?: unknown;
  customerEmail?: unknown;
  customerPhone?: unknown;
  customerWhatsapp?: unknown;
  transactionReference?: unknown;
  screenshotBase64?: unknown;
  screenshotMimeType?: unknown;
  screenshotFilename?: unknown;
  businessId?: unknown; // optional — for existing businesses
}

interface ValidationOk {
  ok: true;
  data: {
    planId: string;
    paymentMethod: 'jazzcash' | 'easypaisa' | 'bank_transfer';
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    customerWhatsapp: string | null;
    transactionReference: string | null;
    screenshotBase64: string | null;
    screenshotMimeType: string | null;
    screenshotFilename: string | null;
    businessId: string | null;
  };
}
interface ValidationErr {
  ok: false;
  message: string;
}

const PAYMENT_METHODS = ['jazzcash', 'easypaisa', 'bank_transfer'] as const;

function validatePayment(body: PaymentBody): ValidationOk | ValidationErr {
  const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
  const paymentMethodRaw =
    typeof body.paymentMethod === 'string' ? body.paymentMethod.trim() : '';
  const customerName =
    typeof body.customerName === 'string' ? body.customerName.trim() : '';
  const customerEmail =
    typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : '';
  const customerPhoneRaw = typeof body.customerPhone === 'string' ? body.customerPhone : '';
  const customerPhone = customerPhoneRaw.replace(/[\s\-()+]/g, '').replace(/^0+/, '');
  const customerWhatsappRaw =
    typeof body.customerWhatsapp === 'string' ? body.customerWhatsapp.trim() : '';
  const customerWhatsapp = customerWhatsappRaw
    ? customerWhatsappRaw.replace(/[\s\-()+]/g, '').replace(/^0+/, '') || null
    : null;
  const transactionReference =
    typeof body.transactionReference === 'string' && body.transactionReference.trim()
      ? body.transactionReference.trim().slice(0, 120)
      : null;
  const screenshotBase64 =
    typeof body.screenshotBase64 === 'string' && body.screenshotBase64.length > 0
      ? body.screenshotBase64
      : null;
  const screenshotMimeType =
    typeof body.screenshotMimeType === 'string' && body.screenshotMimeType
      ? body.screenshotMimeType.slice(0, 60)
      : null;
  const screenshotFilename =
    typeof body.screenshotFilename === 'string' && body.screenshotFilename
      ? body.screenshotFilename.slice(0, 120)
      : null;
  const businessIdRaw =
    typeof body.businessId === 'string' ? body.businessId.trim() : '';
  const businessId =
    businessIdRaw && /^[0-9a-f-]{36}$/i.test(businessIdRaw) ? businessIdRaw : null;

  if (!planId) {
    return { ok: false, message: 'planId is required' };
  }
  if (!PAYMENT_METHODS.includes(paymentMethodRaw as never)) {
    return {
      ok: false,
      message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}`,
    };
  }
  if (customerName.length < 2) {
    return { ok: false, message: 'customerName must be at least 2 characters' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return { ok: false, message: 'email format is invalid' };
  }
  if (!/^\d{10,15}$/.test(customerPhone)) {
    return {
      ok: false,
      message: 'customerPhone must be 10-15 digits (with country code, no + or spaces)',
    };
  }
  // Screenshot is optional (some customers pay then upload later via a
  // separate channel), but if provided it must look like base64.
  if (screenshotBase64 && !/^[A-Za-z0-9+/=\s]+$/.test(screenshotBase64.slice(0, 80))) {
    return { ok: false, message: 'screenshotBase64 is not valid base64' };
  }
  // 24MB defensive cap — base64 inflates ~33%, so the file is ~18MB max.
  // express.json limit is 15MB, so anything beyond that gets rejected at
  // the body parser anyway. This is a defense-in-depth check.
  if (screenshotBase64 && screenshotBase64.length > 24 * 1024 * 1024) {
    return { ok: false, message: 'screenshot exceeds 18MB' };
  }

  return {
    ok: true,
    data: {
      planId,
      paymentMethod: paymentMethodRaw as 'jazzcash' | 'easypaisa' | 'bank_transfer',
      customerName,
      customerEmail,
      customerPhone,
      customerWhatsapp,
      transactionReference,
      screenshotBase64,
      screenshotMimeType,
      screenshotFilename,
      businessId,
    },
  };
}

router.post('/payments', async (req: Request, res: Response) => {
  const result = validatePayment(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ code: 'VALIDATION', message: result.message });
  }
  const data = result.data;

  // Look up the plan to get the canonical price (never trust the client
  // to send amountPkr — we derive it from the plan).
  const { data: plan, error: planErr } = await getSupabase()
    .from('plans')
    .select('id, monthly_price_pkr, is_active')
    .eq('id', data.planId)
    .single();
  if (planErr || !plan) {
    return res.status(400).json({ code: 'VALIDATION', message: 'planId is invalid' });
  }
  if (!plan.is_active) {
    return res.status(400).json({ code: 'VALIDATION', message: 'plan is no longer available' });
  }

  try {
    const { requestId } = await createPaymentRequest({
      businessId: data.businessId,
      planId: plan.id,
      amountPkr: plan.monthly_price_pkr,
      paymentMethod: data.paymentMethod,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone,
      customerWhatsapp: data.customerWhatsapp,
      transactionReference: data.transactionReference,
      screenshotBase64: data.screenshotBase64,
      screenshotMimeType: data.screenshotMimeType,
      screenshotFilename: data.screenshotFilename,
    });

    log.info(
      {
        requestId,
        planId: plan.id,
        amountPkr: plan.monthly_price_pkr,
        method: data.paymentMethod,
        email: data.customerEmail,
        hasBusinessId: !!data.businessId,
      },
      'payment request submitted'
    );

    return res.status(201).json({
      requestId,
      planId: plan.id,
      amountPkr: plan.monthly_price_pkr,
      // Tell the customer what to expect next
      expectedReviewHours: 24,
    });
  } catch (e) {
    log.error(
      { err: (e as Error).message, email: data.customerEmail },
      'payment request submission failed'
    );
    return res.status(500).json({
      code: 'INTERNAL',
      message: 'Could not submit payment. Please try again or contact support.',
    });
  }
});

// ─── GET /api/payments/:id ────────────────────────────────────────────────

router.get('/payments/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ code: 'VALIDATION', message: 'id must be a uuid' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ code: 'VALIDATION', message: 'email query param is required' });
  }

  const { data, error } = await getSupabase()
    .from('payment_requests')
    .select('id, plan_id, amount_pkr, status, rejection_reason, created_at, reviewed_at')
    .eq('id', id)
    .eq('customer_email', email)
    .single();

  if (error || !data) {
    // Don't leak whether the request exists vs. wrong email — return 404
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Payment request not found' });
  }

  return res.json(data);
});

export default router;
