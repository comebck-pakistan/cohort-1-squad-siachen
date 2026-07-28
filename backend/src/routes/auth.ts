// ---------------------------------------------------------------------------
// Owner auth integration.
//
// MVP architecture: the FRONTEND handles signup and login directly via
// Supabase JS using the anon public key
// (https://<project>.supabase.co/auth/v1/...). It receives a JWT and
// stores it; subsequent dashboard API calls send it as
// `Authorization: Bearer <jwt>`.
//
// Backend's role:
//   1. Verify any incoming JWT (requireAuth middleware in lib/auth.ts)
//   2. GET /api/auth/me — return the user's profile + their business row,
//      so the dashboard can render without an extra signup step
//   3. POST /api/auth/onboard-business — once signup is complete in the
//      frontend, the dashboard POSTs here to materialize the businesses
//      row that the schema requires (foreign key from businesses.owner_id
//      → profiles.id).
//
// Why the backend doesn't expose /signup or /login:
//   - Supabase anon client does them for us (with email/password auth
//     enabled, which is one click in the Supabase dashboard)
//   - Bypasses needing to forward credentials through our server
//   - Standard pattern across the Supabase ecosystem
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { requireAuth } from '../lib/auth';

const router = Router();

router.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = getSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, phone')
    .eq('id', req.user.id)
    .maybeSingle();

  const { data: biz } = req.user.businessId
    ? await supabase
        .from('businesses')
        .select('id, name, city, timezone, agent_active')
        .eq('id', req.user.businessId)
        .maybeSingle()
    : { data: null };

  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      full_name: profile?.full_name || null,
      role: profile?.role || 'business_owner',
    },
    business: biz || null,
  });
});

/**
 * POST /api/auth/onboard-business
 * Authorization: Bearer <jwt of user who just signed up>
 * Body: { business_name: string, city?: string, timezone?: string }
 *
 * Creates the businesses row linked to this user's profile. Called
 * once by the dashboard right after signup, before the user can use
 * any /api/business/... endpoints.
 *
 * Idempotent: if this user already owns a business, returns it
 * instead of creating a duplicate.
 */
router.post('/auth/onboard-business', requireAuth, async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  const { business_name, city, timezone = 'Asia/Karachi' } = (req.body || {}) as {
    business_name?: string;
    city?: string;
    timezone?: string;
  };

  if (!business_name) {
    return res.status(400).json({ error: 'Missing business_name' });
  }

  const supabase = getSupabase();

  // Ensure profile exists (may have been created in Supabase auth trigger)
  await supabase.from('profiles').upsert(
    {
      id: req.user.id,
      role: 'business_owner',
      email: req.user.email,
    },
    { onConflict: 'id', ignoreDuplicates: false }
  );

  // Idempotency: if user already owns a business, return it
  const existing = await supabase
    .from('businesses')
    .select('id, name, city, timezone')
    .eq('owner_id', req.user.id)
    .maybeSingle();

  if (existing.data) {
    return res.json({ business: existing.data, already_existed: true });
  }

  const { data, error } = await supabase
    .from('businesses')
    .insert({
      name: business_name,
      business_type: 'salon',
      city: city || null,
      timezone,
      owner_id: req.user.id,
    })
    .select('id, name, city, timezone')
    .single();

  if (error || !data) {
    return res.status(500).json({
      error: `Failed to create business: ${error?.message || 'unknown'}`,
    });
  }

  return res.status(201).json({ business: data, already_existed: false });
});

export default router;
