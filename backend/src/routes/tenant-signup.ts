// ---------------------------------------------------------------------------
// Tenant signup + starter-catalog.
//
// Designed for the Recepta onboarding flow: a brand-new salon owner fills
// a form (name, mobile, business type, city, services they want) and we
// create their entire account in one shot.
//
// POST /api/auth/signup-tenant
//   Body: {
//     business_name, owner_name, owner_email, owner_phone,
//     whatsapp_number?, city?, business_type: 'salon'|'barbershop'|'spa'|'nails',
//     additional_services?: Array<{name, duration_minutes, price?}>
//   }
//   Returns: { auth_user_id, business_id, temp_password,
//              initial_services_added, delivery: 'console' }
//
// GET /api/services/starter-catalog?business_type=...
//   Returns 3-5 generic services pre-loaded by category so the onboarding
//   form's dropdowns can populate without a hardcoded list in the UI.
//
// Auth & integration notes:
//   - The endpoint is intentionally unauthenticated (it's a signup).
//   - It uses SUPABASE_SERVICE_ROLE_KEY via Admin API to create the
//     auth user — bypassing the fragility of raw INSERT INTO auth.users.
//   - The temp password is generated server-side, logged to console (no
//     email provider integrated yet) and returned to the client so the
//     "Check your email" screen can show it during the demo.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { getSupabase } from '../lib/supabase';
import { childLogger } from '../lib/logger';

const router = Router();
const log = childLogger('tenant-signup');

// ---------------------------------------------------------------------------
// Starter catalog — keyed by business_type.
//
// Each entry is a generic service a brand-new salon of that type would
// typically offer. Prices are conservative mid-ranges; owners will edit
// them in /salon-portal/business → Services Catalog once logged in.
//
// The frontend (`/tenant-signup` form) should call this endpoint, render
// the returned items as default selected services, and let owners uncheck
// or +add more.
// ---------------------------------------------------------------------------
const STARTER_CATALOG: Record<
  string,
  Array<{
    name: string;
    duration_minutes: number;
    price: number;
    category: string;
  }>
> = {
  // Men's salon / barbershop
  barbershop: [
    { name: 'Classic Haircut', duration_minutes: 30, price: 800, category: 'Hair' },
    { name: 'Beard Trim', duration_minutes: 20, price: 500, category: 'Hair' },
    { name: 'Hair + Beard Combo', duration_minutes: 45, price: 1200, category: 'Hair' },
    { name: 'Hair Wash', duration_minutes: 15, price: 300, category: 'Hair' },
    { name: 'Kids Haircut', duration_minutes: 25, price: 600, category: 'Hair' },
  ],
  // Women's salon (hair + skin)
  salon: [
    { name: 'Haircut & Style', duration_minutes: 45, price: 2000, category: 'Hair' },
    { name: 'Hair Color', duration_minutes: 90, price: 5000, category: 'Hair' },
    { name: 'Blow Dry', duration_minutes: 30, price: 1500, category: 'Hair' },
    { name: 'Classic Facial', duration_minutes: 60, price: 3500, category: 'Skin' },
    { name: 'Threading', duration_minutes: 15, price: 300, category: 'Skin' },
  ],
  // Nail bar
  nails: [
    { name: 'Classic Manicure', duration_minutes: 45, price: 1500, category: 'Nails' },
    { name: 'Gel Manicure', duration_minutes: 60, price: 2500, category: 'Nails' },
    { name: 'Classic Pedicure', duration_minutes: 60, price: 2000, category: 'Nails' },
    { name: 'Gel Pedicure', duration_minutes: 75, price: 3000, category: 'Nails' },
    { name: 'Nail Art (per nail)', duration_minutes: 10, price: 200, category: 'Nails' },
  ],
  // Spa / unisex
  spa: [
    { name: 'Full Body Massage (60 min)', duration_minutes: 60, price: 5000, category: 'Spa' },
    { name: 'Aromatherapy Facial', duration_minutes: 75, price: 4500, category: 'Skin' },
    { name: 'Body Scrub', duration_minutes: 45, price: 3500, category: 'Spa' },
    { name: 'Manicure + Pedicure Combo', duration_minutes: 90, price: 3500, category: 'Nails' },
  ],
};

const ALLOWED_TYPES = Object.keys(STARTER_CATALOG);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a 12-character random password — readable (no 0/O/1/l collision),
 * sufficient entropy for the demo. Returned to the client + logged.
 *
 * Production note: switch to a per-user magic-link or invite flow so we
 * never transmit the password over the wire.
 */
function generateTempPassword(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += charset[bytes[i] % charset.length];
  return out + '!Aa1'; // ensure complexity for any password policy check
}

/**
 * Postgres has reserved weekdays 'sun'..'sat'. Returns the seven hours
 * rows a brand-new salon needs (with is_open=false so the dashboard's
 * "weekly schedule" toggle kicks in from a known empty state).
 */
function defaultBusinessHours(): Array<{
  day_of_week: string;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
}> {
  const allDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return allDays.map((d) => ({
    day_of_week: d,
    is_open: false,
    open_time: null,
    close_time: null,
  }));
}

// ---------------------------------------------------------------------------
// 1. GET /api/services/starter-catalog
//
// Returns the 3-5 default services for a given business type so the
// onboarding form can render pre-selected checkboxes.
// ---------------------------------------------------------------------------
router.get('/services/starter-catalog', (req: Request, res: Response) => {
  const businessType =
    ((req.query.business_type as string) || 'salon').toLowerCase();

  const items = STARTER_CATALOG[businessType];
  if (!items) {
    return res.status(400).json({
      error: `Unknown business_type "${businessType}". Allowed: ${ALLOWED_TYPES.join(', ')}`,
      allowed_types: ALLOWED_TYPES,
    });
  }

  return res.json({
    business_type: businessType,
    services: items,
  });
});

// ---------------------------------------------------------------------------
// 2. POST /api/auth/signup-tenant
//
// One-shot onboarding: creates auth user, profile, business, hours,
// and starter services in sequence. Returns enough info for the
// "Check your email" success screen.
// ---------------------------------------------------------------------------
router.post('/auth/signup-tenant', async (req: Request, res: Response) => {
  const {
    business_name,
    owner_name,
    owner_email,
    owner_phone,
    owner_password,
    whatsapp_number,
    city,
    business_type = 'salon',
    additional_services,
  } = (req.body || {}) as {
    business_name?: string;
    owner_name?: string;
    owner_email?: string;
    owner_phone?: string;
    owner_password?: string;
    whatsapp_number?: string;
    city?: string;
    business_type?: string;
    additional_services?: Array<{
      name: string;
      duration_minutes: number;
      price?: number;
      category?: string;
    }>;
  };

  // ---- Validation --------------------------------------------------------
  if (!business_name || !owner_email || !owner_phone) {
    return res.status(400).json({
      error: 'Missing required fields: business_name, owner_email, owner_phone',
    });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner_email)) {
    return res.status(400).json({ error: 'Invalid owner_email format' });
  }
  if (!owner_phone.replace(/\D/g, '').match(/^\d{7,15}$/)) {
    return res
      .status(400)
      .json({ error: 'owner_phone must contain 7-15 digits' });
  }

  const normalizedType =
    ALLOWED_TYPES.find((t) => t === business_type.toLowerCase()) ||
    (business_type.toLowerCase().includes('barber')
      ? 'barbershop'
      : business_type.toLowerCase().includes('nail')
      ? 'nails'
      : business_type.toLowerCase().includes('spa')
      ? 'spa'
      : 'salon');

  // ---- Step 1: Create auth user via Admin API ----------------------------
  if (owner_password && owner_password.length < 8) {
    return res.status(400).json({ error: 'owner_password must be at least 8 characters' });
  }
  const tempPassword = owner_password || generateTempPassword();
  const supabase = getSupabase();

  const { data: created, error: createErr } =
    await supabase.auth.admin.createUser({
      email: owner_email,
      password: tempPassword,
      email_confirm: true, // skip the email verification round-trip for the demo
      user_metadata: { full_name: owner_name || 'Salon Owner' },
      app_metadata: { role: 'business_owner' },
    });

  if (createErr || !created?.user) {
    log.error(
      { err: createErr?.message, owner_email },
      'failed to create auth user'
    );
    return res.status(500).json({
      error: `Failed to create auth user: ${createErr?.message || 'unknown'}`,
    });
  }

  const userId = created.user.id;

  // ---- Step 2: Ensure profile row exists --------------------------------
  // Auth trigger (04_auth_trigger.sql) usually creates this, but we upsert
  // defensively in case the trigger failed or hasn't run yet.
  const { error: profileErr } = await supabase.from('profiles').upsert(
    {
      id: userId,
      role: 'business_owner',
      full_name: owner_name || 'Salon Owner',
      phone: owner_phone,
    },
    { onConflict: 'id', ignoreDuplicates: false }
  );
  if (profileErr) {
    log.warn(
      { err: profileErr.message, userId },
      'profile upsert failed (continuing)'
    );
  }

  // ---- Step 3: Create businesses row ------------------------------------
  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .insert({
      name: business_name,
      business_type: normalizedType,
      city: city || null,
      whatsapp_number: whatsapp_number || owner_phone,
      owner_id: userId,
      agent_active: true,
    })
    .select('id, name, business_type, city')
    .single();
  if (bizErr || !biz) {
    log.error(
      { err: bizErr?.message, userId },
      'failed to create businesses row'
    );
    return res.status(500).json({
      error: `Failed to create business: ${bizErr?.message || 'unknown'}`,
      auth_user_id: userId,
    });
  }

  const businessId = biz.id;

  // ---- Step 4: Seed default business_hours (all closed) ----------------
  // Owner toggles them on from the dashboard after login.
  const hours = defaultBusinessHours();
  for (const h of hours) {
    const { error: hourErr } = await supabase.from('business_hours').upsert(
      {
        business_id: businessId,
        day_of_week: h.day_of_week,
        is_open: h.is_open,
        open_time: h.open_time,
        close_time: h.close_time,
      },
      { onConflict: 'business_id,day_of_week' }
    );
    if (hourErr) {
      log.warn(
        { day: h.day_of_week, err: hourErr.message },
        'business_hours seed failed (continuing)'
      );
    }
  }

  // ---- Step 5: Seed starter services ------------------------------------
  const starterServices = STARTER_CATALOG[normalizedType];
  const combined = [
    ...starterServices,
    ...((additional_services || []).map((s) => ({
      name: s.name,
      duration_minutes: s.duration_minutes,
      price: s.price ?? null,
      category: s.category ?? 'Other',
    })) || []),
  ];

  let seededCount = 0;
  if (combined.length > 0) {
    const rows = combined.map((s) => ({
      business_id: businessId,
      name: s.name,
      duration_minutes: s.duration_minutes,
      price: s.price ?? null,
      category: s.category ?? null,
      staff_required: 1,
      is_active: true,
    }));
    const { data: inserted, error: svcErr } = await supabase
      .from('services')
      .insert(rows)
      .select('id');
    if (svcErr) {
      log.warn(
        { err: svcErr.message, businessId },
        'service seed failed (continuing)'
      );
    } else {
      seededCount = inserted?.length || 0;
    }
  }

  // ---- Step 6: Log the credentials --------------------------------------
  // No email provider wired up yet — we print to backend logs so the
  // operator can copy them into the "Check your email" demo screen, and
  // also return them in the response so the frontend can display.
  log.warn(
    {
      owner_email,
      business_name,
      business_id: businessId,
      auth_user_id: userId,
      temp_password: owner_password ? '[user supplied]' : tempPassword,
    },
    '🔐 NEW TENANT CREDENTIALS — copy these into the demo "email sent" screen'
  );

  return res.status(201).json({
    auth_user_id: userId,
    business_id: businessId,
    business_name: biz.name,
    business_type: biz.business_type,
    email: owner_email,
    ...(owner_password ? {} : { temp_password: tempPassword }),
    delivery: 'console',
    // In production this would be 'email' or 'whatsapp' and the password
    // would NOT be in the response.
    initial_services_added: seededCount,
    next_step:
      'Open http://localhost:3000/health to confirm, then sign in at /login with the printed credentials.',
  });
});

export default router;
