// ---------------------------------------------------------------------------
// Superadmin payment-approval endpoints — Wave 13.
//
// Endpoints (mounted at /api):
//   GET  /api/superadmin/payments            — list (filter by status)
//   POST /api/superadmin/payments/:id/approve — approve + activate subscription
//   POST /api/superadmin/payments/:id/reject  — reject + reason
//   GET  /api/superadmin/payments/:id/screenshot-url — short-lived signed URL
//
// All require (requireAuth, requireSuperadmin) — same as routes/superadmin.ts.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { requireAuth } from '../lib/auth';
import { childLogger } from '../lib/logger';
import {
  approvePayment,
  rejectPayment,
  getScreenshotSignedUrl,
} from '../lib/payments';

const router = Router();
const log = childLogger('superadmin-payments');

// Copied from superadmin.ts:39-54 — same requireSuperadmin pattern.
const requireSuperadmin: import('express').RequestHandler = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.isSuperadmin) return next();
  const supabase = getSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  return next();
};

const authSuper = [requireAuth, requireSuperadmin] as const;

// ─── GET /api/superadmin/payments ─────────────────────────────────────────

router.get('/superadmin/payments', ...authSuper, async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);

  let query = getSupabase()
    .from('payment_requests')
    .select(
      `
      id,
      business_id,
      plan_id,
      amount_pkr,
      payment_method,
      customer_name,
      customer_email,
      customer_phone,
      customer_whatsapp,
      transaction_reference,
      screenshot_url,
      status,
      rejection_reason,
      reviewed_by,
      reviewed_at,
      review_notes,
      created_at,
      updated_at,
      expires_at
    `,
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status && ['pending', 'approved', 'rejected', 'expired'].includes(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    log.error({ err: error.message, status }, 'list payments failed');
    return res.status(500).json({ code: 'INTERNAL', message: 'Could not list payments' });
  }

  return res.json({ payments: data || [] });
});

// ─── POST /api/superadmin/payments/:id/approve ────────────────────────────

router.post(
  '/superadmin/payments/:id/approve',
  ...authSuper,
  async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'id must be a uuid' });
    }

    const reviewNotes =
      typeof req.body?.reviewNotes === 'string' ? req.body.reviewNotes.slice(0, 500) : undefined;

    try {
      const result = await approvePayment({
        paymentRequestId: id,
        reviewerId: req.user!.id,
        reviewNotes,
      });
      return res.json({
        ok: true,
        subscriptionStatus: result.subscriptionStatus,
        nextBillingDate: result.nextBillingDate,
      });
    } catch (e) {
      const msg = (e as Error).message;
      log.error({ err: msg, requestId: id }, 'approve failed');
      // Distinguish not-found / wrong-state / unknown
      if (msg.includes('not found')) {
        return res.status(404).json({ code: 'NOT_FOUND', message: msg });
      }
      if (msg.includes('cannot approve')) {
        return res.status(409).json({ code: 'CONFLICT', message: msg });
      }
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not approve payment' });
    }
  },
);

// ─── POST /api/superadmin/payments/:id/reject ─────────────────────────────

router.post(
  '/superadmin/payments/:id/reject',
  ...authSuper,
  async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'id must be a uuid' });
    }

    const reason =
      typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (reason.length < 3) {
      return res
        .status(400)
        .json({ code: 'VALIDATION', message: 'reason is required (min 3 chars)' });
    }
    const reviewNotes =
      typeof req.body?.reviewNotes === 'string' ? req.body.reviewNotes.slice(0, 500) : undefined;

    try {
      await rejectPayment({
        paymentRequestId: id,
        reviewerId: req.user!.id,
        reason,
        reviewNotes,
      });
      return res.json({ ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      log.error({ err: msg, requestId: id }, 'reject failed');
      if (msg.includes('not found')) {
        return res.status(404).json({ code: 'NOT_FOUND', message: msg });
      }
      if (msg.includes('cannot reject')) {
        return res.status(409).json({ code: 'CONFLICT', message: msg });
      }
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not reject payment' });
    }
  },
);

// ─── GET /api/superadmin/payments/:id/screenshot-url ──────────────────────

router.get(
  '/superadmin/payments/:id/screenshot-url',
  ...authSuper,
  async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'id must be a uuid' });
    }

    const { data, error } = await getSupabase()
      .from('payment_requests')
      .select('screenshot_url')
      .eq('id', id)
      .single();
    if (error || !data) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'payment request not found' });
    }
    if (!data.screenshot_url) {
      return res
        .status(404)
        .json({ code: 'NO_SCREENSHOT', message: 'no screenshot uploaded for this request' });
    }

    try {
      const url = await getScreenshotSignedUrl(data.screenshot_url, 600);
      return res.json({ url, expiresInSec: 600 });
    } catch (e) {
      log.error(
        { err: (e as Error).message, requestId: id },
        'signed url generation failed'
      );
      return res
        .status(500)
        .json({ code: 'INTERNAL', message: 'Could not generate screenshot URL' });
    }
  },
);

export default router;
