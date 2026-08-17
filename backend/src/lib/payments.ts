// ---------------------------------------------------------------------------
// Payment service layer — Wave 13.
//
// Responsibilities:
//   1. createPaymentRequest(input) — uploads screenshot to Supabase Storage,
//      inserts a payment_requests row, writes audit log.
//   2. approvePayment(id, reviewerId) — flips business to active,
//      sets next_billing_date = now + 30 days, updates plan_id, writes audit.
//   3. rejectPayment(id, reason, reviewerId) — marks row rejected.
//   4. expireOverdueSubscriptions() — called by cron: locks agent when
//      active subscription's next_billing_date has passed.
//
// The base64-in-JSON upload pattern mirrors the deprecated public-onboarding
// route (Phase 0), keeping the existing 15MB express.json limit and avoiding
// any new multipart dependency.
//
// Compensating deletes: if a DB insert fails after a successful upload, we
// delete the orphan storage object so the bucket doesn't accumulate junk.
// ---------------------------------------------------------------------------

import { getSupabase } from './supabase';
import { childLogger } from './logger';

const log = childLogger('payments');

export const PAYMENT_SCREENSHOTS_BUCKET = 'payment-screenshots';

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Strict-UUID check. The `reviewed_by` column on `payment_requests` is a
 * uuid-typed FK to `profiles(id)`. The superadmin token holder has no
 * real Supabase auth profile, so `req.user.id` is the sentinel
 * `'superadmin-secret'`. Writing that string into a uuid column raises
 * `invalid input syntax for type uuid`. Use this guard before assigning
 * `reviewed_by` — write null when not a UUID. The audit log actor_id is
 * a text column so it keeps the sentinel for traceability.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function asUuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

// ─── Types ────────────────────────────────────────────────────────────────

export type PaymentMethod = 'jazzcash' | 'easypaisa' | 'bank_transfer';
export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface CreatePaymentRequestInput {
  businessId: string | null;            // null for new businesses without an account yet
  planId: string;
  amountPkr: number;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerWhatsapp: string | null;
  transactionReference: string | null;
  screenshotBase64: string | null;       // raw base64 (no data: prefix)
  screenshotMimeType: string | null;
  screenshotFilename: string | null;
}

export interface CreatePaymentRequestResult {
  requestId: string;
}

export interface ApprovePaymentInput {
  paymentRequestId: string;
  reviewerId: string;
  reviewNotes?: string;
}

export interface RejectPaymentInput {
  paymentRequestId: string;
  reviewerId: string;
  reason: string;
  reviewNotes?: string;
}

// ─── Storage helpers ──────────────────────────────────────────────────────

/**
 * Best-effort: ensure the payment-screenshots bucket exists. Idempotent.
 * Failure is logged but non-fatal — if the bucket already exists, the
 * `createBucket` call returns 400 with "already exists" which we ignore.
 */
export async function ensureBucket(): Promise<void> {
  const supabase = getSupabase();
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    log.warn({ err: listErr.message }, 'ensureBucket: listBuckets failed');
    return;
  }
  const exists = (buckets || []).some((b) => b.name === PAYMENT_SCREENSHOTS_BUCKET);
  if (exists) return;

  const { error: createErr } = await supabase.storage.createBucket(
    PAYMENT_SCREENSHOTS_BUCKET,
    { public: false }
  );
  if (createErr && !createErr.message.includes('already exists')) {
    log.warn({ err: createErr.message }, 'ensureBucket: createBucket failed');
  }
}

function sanitizeFilename(name: string): string {
  // Strip path-y characters and collapse whitespace. Keep the extension.
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 80);
}

function guessExt(mime: string | null, filename: string | null): string {
  if (filename && filename.includes('.')) {
    return filename.split('.').pop()!.toLowerCase().slice(0, 5);
  }
  if (!mime) return 'bin';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  return 'bin';
}

async function uploadScreenshot(args: {
  base64: string;
  mimeType: string | null;
  filename: string | null;
  requestId: string;
}): Promise<string> {
  const { base64, mimeType, filename, requestId } = args;
  const ext = guessExt(mimeType, filename);
  const safeName = sanitizeFilename(filename || 'screenshot') || 'screenshot';
  const path = `${requestId}/${Date.now()}_${safeName}.${ext}`;

  const buffer = Buffer.from(base64, 'base64');
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(PAYMENT_SCREENSHOTS_BUCKET)
    .upload(path, buffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    throw new Error(`screenshot upload failed: ${error.message}`);
  }
  return path;
}

async function deleteScreenshot(path: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(PAYMENT_SCREENSHOTS_BUCKET)
    .remove([path]);
  if (error) {
    log.warn({ path, err: error.message }, 'compensating storage delete failed');
  }
}

// ─── Audit log ────────────────────────────────────────────────────────────

async function writeAudit(
  paymentRequestId: string | null,
  businessId: string | null,
  action: string,
  actorId: string | null,
  actorType: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await getSupabase().from('payment_audit_log').insert({
    payment_request_id: paymentRequestId,
    business_id: businessId,
    action,
    actor_id: actorId,
    actor_type: actorType,
    metadata,
  });
  if (error) {
    log.warn(
      { err: error.message, action, paymentRequestId },
      'audit log write failed (non-fatal)'
    );
  }
}

// ─── Create ───────────────────────────────────────────────────────────────

export async function createPaymentRequest(
  input: CreatePaymentRequestInput
): Promise<CreatePaymentRequestResult> {
  await ensureBucket();

  // Insert the row first so we have a stable id for the storage path.
  // If the upload fails, we delete the row. If the upload succeeds and
  // a later step fails, we delete the file.
  const supabase = getSupabase();
  const { data: inserted, error: insertErr } = await supabase
    .from('payment_requests')
    .insert({
      business_id: input.businessId,
      plan_id: input.planId,
      amount_pkr: input.amountPkr,
      payment_method: input.paymentMethod,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
      customer_whatsapp: input.customerWhatsapp,
      transaction_reference: input.transactionReference,
      screenshot_url: null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    log.error(
      { err: insertErr?.message, planId: input.planId, email: input.customerEmail },
      'createPaymentRequest: row insert failed'
    );
    throw new Error('Could not save payment request');
  }

  const requestId: string = inserted.id;

  // Upload screenshot (best-effort). If no file provided, skip.
  let screenshotPath: string | null = null;
  if (input.screenshotBase64 && input.screenshotBase64.length > 0) {
    try {
      screenshotPath = await uploadScreenshot({
        base64: input.screenshotBase64,
        mimeType: input.screenshotMimeType,
        filename: input.screenshotFilename,
        requestId,
      });
    } catch (e) {
      // Compensate the row
      await getSupabase().from('payment_requests').delete().eq('id', requestId);
      log.error(
        { err: (e as Error).message, requestId },
        'createPaymentRequest: screenshot upload failed, rolled back row'
      );
      throw e;
    }

    // Update with the path
    const { error: updateErr } = await supabase
      .from('payment_requests')
      .update({ screenshot_url: screenshotPath })
      .eq('id', requestId);
    if (updateErr) {
      // Compensate both
      await deleteScreenshot(screenshotPath);
      await getSupabase().from('payment_requests').delete().eq('id', requestId);
      log.error(
        { err: updateErr.message, requestId },
        'createPaymentRequest: path update failed, rolled back'
      );
      throw new Error('Could not save payment request');
    }
  }

  await writeAudit(requestId, input.businessId, 'created', null, 'customer', {
    plan_id: input.planId,
    amount_pkr: input.amountPkr,
    payment_method: input.paymentMethod,
    has_screenshot: !!screenshotPath,
  });

  log.info(
    {
      requestId,
      businessId: input.businessId,
      planId: input.planId,
      method: input.paymentMethod,
      amountPkr: input.amountPkr,
      hasScreenshot: !!screenshotPath,
    },
    'payment request created'
  );

  return { requestId };
}

// ─── Approve ──────────────────────────────────────────────────────────────

/**
 * Approve a payment request:
 *   1. Flip status -> 'approved'
 *   2. Update businesses row: subscription_status='active',
 *      plan_id=<plan>, next_billing_date=now+30d, payment_method=<method>
 *   3. Write audit log
 *
 * Caller is responsible for verifying the caller is superadmin.
 */
export async function approvePayment(
  input: ApprovePaymentInput
): Promise<{ subscriptionStatus: string; nextBillingDate: string }> {
  const supabase = getSupabase();

  // Read the request first
  const { data: req, error: reqErr } = await supabase
    .from('payment_requests')
    .select('id, business_id, plan_id, payment_method, status, amount_pkr')
    .eq('id', input.paymentRequestId)
    .single();

  if (reqErr || !req) {
    throw new Error(`payment request not found: ${reqErr?.message ?? 'null'}`);
  }
  if (req.status !== 'pending') {
    throw new Error(`payment request is ${req.status}, cannot approve`);
  }

  const nextBillingDate = new Date(Date.now() + 30 * 86400_000).toISOString();
  const reviewedByPatch = asUuidOrNull(input.reviewerId);

  // Mark approved
  const { error: approveErr } = await supabase
    .from('payment_requests')
    .update({
      status: 'approved',
      reviewed_by: reviewedByPatch,
      reviewed_at: new Date().toISOString(),
      review_notes: input.reviewNotes ?? null,
    })
    .eq('id', req.id);

  if (approveErr) {
    log.error(
      { err: approveErr.message, requestId: req.id },
      'approvePayment: status update failed'
    );
    throw new Error('Could not approve payment');
  }

  // Activate the business subscription
  if (req.business_id) {
    const { error: bizErr } = await supabase
      .from('businesses')
      .update({
        subscription_status: 'active',
        plan_id: req.plan_id,
        next_billing_date: nextBillingDate,
        payment_method: req.payment_method,
        agent_active: true,
      })
      .eq('id', req.business_id);

    if (bizErr) {
      log.error(
        { err: bizErr.message, businessId: req.business_id },
        'approvePayment: business update failed'
      );
      throw new Error('Payment approved but business activation failed');
    }
  }

  await writeAudit(req.id, req.business_id, 'approved', input.reviewerId, 'superadmin', {
    plan_id: req.plan_id,
    amount_pkr: req.amount_pkr,
    next_billing_date: nextBillingDate,
    review_notes: input.reviewNotes ?? null,
  });

  log.info(
    {
      requestId: req.id,
      businessId: req.business_id,
      planId: req.plan_id,
      reviewerId: input.reviewerId,
      nextBillingDate,
    },
    'payment approved + subscription activated'
  );

  return {
    subscriptionStatus: 'active',
    nextBillingDate,
  };
}

// ─── Reject ───────────────────────────────────────────────────────────────

export async function rejectPayment(
  input: RejectPaymentInput
): Promise<void> {
  const supabase = getSupabase();

  const { data: req, error: reqErr } = await supabase
    .from('payment_requests')
    .select('id, business_id, status')
    .eq('id', input.paymentRequestId)
    .single();

  if (reqErr || !req) {
    throw new Error(`payment request not found: ${reqErr?.message ?? 'null'}`);
  }
  if (req.status !== 'pending') {
    throw new Error(`payment request is ${req.status}, cannot reject`);
  }

  const reviewedByPatch = asUuidOrNull(input.reviewerId);

  const { error: rejectErr } = await supabase
    .from('payment_requests')
    .update({
      status: 'rejected',
      reviewed_by: reviewedByPatch,
      reviewed_at: new Date().toISOString(),
      rejection_reason: input.reason,
      review_notes: input.reviewNotes ?? null,
    })
    .eq('id', req.id);

  if (rejectErr) {
    log.error(
      { err: rejectErr.message, requestId: req.id },
      'rejectPayment: status update failed'
    );
    throw new Error('Could not reject payment');
  }

  await writeAudit(req.id, req.business_id, 'rejected', input.reviewerId, 'superadmin', {
    reason: input.reason,
    review_notes: input.reviewNotes ?? null,
  });

  log.info(
    {
      requestId: req.id,
      businessId: req.business_id,
      reviewerId: input.reviewerId,
      reason: input.reason,
    },
    'payment rejected'
  );
}

// ─── Expiry (cron) ───────────────────────────────────────────────────────

/**
 * Hourly sweep: find active subscriptions whose next_billing_date has
 * passed and lock the agent. Same pattern as trial-expiry.ts.
 */
export async function expireOverdueSubscriptions(): Promise<void> {
  const nowIso = new Date().toISOString();
  const supabase = getSupabase();

  const { data: overdue, error: queryErr } = await supabase
    .from('businesses')
    .select('id, name, plan_id, next_billing_date')
    .eq('subscription_status', 'active')
    .lt('next_billing_date', nowIso);

  if (queryErr) {
    log.error({ err: queryErr.message }, 'subscription-expiry: query failed');
    return;
  }

  if (!overdue || overdue.length === 0) return;

  const ids = overdue.map((b) => b.id);
  const { error: flipErr } = await supabase
    .from('businesses')
    .update({
      subscription_status: 'expired',
      agent_active: false,
    })
    .in('id', ids);

  if (flipErr) {
    log.error(
      { err: flipErr.message, count: ids.length },
      'subscription-expiry: bulk flip failed'
    );
    return;
  }

  for (const b of overdue) {
    await writeAudit(null, b.id, 'subscription_expired_locks_agent', null, 'system', {
      plan_id: b.plan_id,
      next_billing_date: b.next_billing_date,
    });
  }

  log.info(
    { count: overdue.length, businessIds: ids },
    'subscription-expiry: locked agents for overdue subscriptions'
  );
}

// ─── Screenshot signed URL ────────────────────────────────────────────────

/**
 * Generate a short-lived signed URL for superadmin to view the screenshot.
 * Default 10-minute expiry.
 */
export async function getScreenshotSignedUrl(
  storagePath: string,
  expiresInSec: number = 600
): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(PAYMENT_SCREENSHOTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSec);
  if (error || !data) {
    throw new Error(`signed url failed: ${error?.message ?? 'null'}`);
  }
  return data.signedUrl;
}
