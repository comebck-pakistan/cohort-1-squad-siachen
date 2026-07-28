// ---------------------------------------------------------------------------
// Onboarding status endpoint — used by the Recepta QR modal.
//
// Lives outside /api because it shares the URL space with the QR
// server in whatsapp-web/qr-server.ts. Both expose /onboarding/:id/*
// routes so the dashboard's QR modal can poll for status regardless
// of which transport is configured.
//
// Auth: same superadmin requirement as the platform endpoints — only
// platform operators should see the QR status of any tenant.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { requireAuth } from '../lib/auth';

const router = Router();

const requireSuperadmin = async (
  req: Request,
  res: Response,
  next: () => void
) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const supabase = getSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
};

// GET /onboarding/:businessId/status
router.get(
  '/onboarding/:businessId/status',
  requireAuth,
  requireSuperadmin,
  async (req: Request, res: Response) => {
    const { businessId } = req.params;
    const supabase = getSupabase();

    const { data: biz } = await supabase
      .from('businesses')
      .select('id, agent_active')
      .eq('id', businessId)
      .maybeSingle();

    if (!biz) {
      return res.json({
        businessId,
        status: 'not_found',
        hasQR: false,
      });
    }

    // Simplified onboarding status — derived from agent_active.
    // The session-manager has its own in-memory map of QR-ready state,
    // but exposing that via HTTP requires plumbing the SessionManager
    // into this router. MVP: agent active → "ready", otherwise "qr_ready".
    const status = biz.agent_active ? 'ready' : 'qr_ready';
    return res.json({
      businessId,
      status,
      hasQR: status === 'qr_ready' || status === 'ready',
    });
  }
);

export default router;
