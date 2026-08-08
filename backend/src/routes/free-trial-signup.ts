// ---------------------------------------------------------------------------
// Free-trial signup — replaces the orphaned `tenant-signup.ts` for the
// Recepta onboarding flow.
//
// One POST creates everything needed for a brand-new salon to log in and
// start receiving WhatsApp customers:
//
//   1. Supabase auth user (password supplied by the owner — not generated)
//   2. Auth trigger auto-inserts `profiles` row (04_auth_trigger.sql)
//   3. `businesses` row linked to that profile
//   4. N rows in `services` matching the canonical schema used by the
//      salon-portal dashboard's Services tab (dashboard.ts:308)
//
// On failure of any post-auth step, the auth user is deleted as a
// compensating action so we never leave orphan auth users without a
// business row (which would block them via RLS policies).
//
// No default business_hours are seeded — the wizard no longer collects
// hours. The owner sets them from the dashboard after login.
// No payment step. No persona/tone/language picker. No OCR. Those are
// deferred to Phase 2 (trial expiry + tier upgrade + menu parsing).
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { childLogger } from '../lib/logger';

const router = Router();
const log = childLogger('onboarding.free-trial');

// ---- Types -----------------------------------------------------------------

type SalonTypeDisplay =
  | 'Hair Salon'
  | 'Nail Bar'
  | 'MedSpa'
  | 'Barbershop'
  | 'Lash & Brow Studio';

interface ServiceInput {
  name: string;
  duration_minutes: number;
  price?: number;
  category?: string;
}

interface SignupBody {
  salonName?: unknown;
  salonType?: unknown;
  city?: unknown;
  email?: unknown;
  password?: unknown;
  services?: unknown;
}

// Map the wizard's display labels to the canonical lowercase business_type
// values used elsewhere in the codebase (tenant-signup.ts:206-214 + the
// dashboard's business_type column). Unknown values fall back to 'salon'.
const SALON_TYPE_MAP: Record<SalonTypeDisplay, string> = {
  'Hair Salon': 'salon',
  'Nail Bar': 'nails',
  MedSpa: 'spa',
  Barbershop: 'barbershop',
  'Lash & Brow Studio': 'salon',
};

function normalizeSalonType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw in SALON_TYPE_MAP) return SALON_TYPE_MAP[raw as SalonTypeDisplay];
  return null;
}

// ---- Validation ------------------------------------------------------------

interface ValidationOk {
  ok: true;
  data: {
    salonName: string;
    salonTypeCanonical: string;
    city: string;
    email: string;
    password: string;
    services: ServiceInput[];
  };
}
interface ValidationErr {
  ok: false;
  message: string;
}

function validate(body: SignupBody): ValidationOk | ValidationErr {
  const salonName = typeof body.salonName === 'string' ? body.salonName.trim() : '';
  const salonTypeCanonical = normalizeSalonType(body.salonType);
  const city = typeof body.city === 'string' ? body.city.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const servicesRaw = Array.isArray(body.services) ? body.services : [];

  if (salonName.length < 2) {
    return { ok: false, message: 'salonName must be at least 2 characters' };
  }
  if (!salonTypeCanonical) {
    return {
      ok: false,
      message:
        'salonType must be one of: Hair Salon, Nail Bar, MedSpa, Barbershop, Lash & Brow Studio',
    };
  }
  if (city.length < 2) {
    return { ok: false, message: 'city is required' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'email format is invalid' };
  }
  if (password.length < 8) {
    return { ok: false, message: 'password must be at least 8 characters' };
  }
  if (servicesRaw.length < 1) {
    return { ok: false, message: 'at least one service is required' };
  }

  const services: ServiceInput[] = [];
  for (let i = 0; i < servicesRaw.length; i++) {
    const raw = servicesRaw[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') {
      return { ok: false, message: `services[${i}] is malformed` };
    }
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const duration = raw.duration_minutes;
    if (name.length < 1) {
      return { ok: false, message: `services[${i}].name is required` };
    }
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 5) {
      return {
        ok: false,
        message: `services[${i}].duration_minutes must be an integer ≥ 5`,
      };
    }
    let price: number | undefined;
    if (raw.price !== undefined && raw.price !== null) {
      if (typeof raw.price !== 'number' || raw.price < 0 || !Number.isFinite(raw.price)) {
        return { ok: false, message: `services[${i}].price must be a non-negative number` };
      }
      price = raw.price;
    }
    const category =
      typeof raw.category === 'string' && raw.category.trim().length > 0
        ? raw.category.trim()
        : undefined;
    services.push({ name, duration_minutes: duration, price, category });
  }

  return {
    ok: true,
    data: {
      salonName,
      salonTypeCanonical,
      city,
      email,
      password,
      services,
    },
  };
}

// ---- Compensating deleteUser ----------------------------------------------

async function compensateDeleteUser(userId: string, reason: string): Promise<void> {
  try {
    const { error } = await getSupabase().auth.admin.deleteUser(userId);
    if (error) {
      log.error(
        { err: error, userId, reason },
        'compensating deleteUser failed — auth user orphaned, manual cleanup required',
      );
    } else {
      log.warn({ userId, reason }, 'compensating deleteUser succeeded');
    }
  } catch (e) {
    log.error(
      { err: e, userId, reason },
      'compensating deleteUser threw — auth user orphaned, manual cleanup required',
    );
  }
}

// ---- Handler ---------------------------------------------------------------

router.post('/onboarding/free-trial-signup', async (req: Request, res: Response) => {
  const result = validate(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ code: 'VALIDATION', message: result.message });
  }
  const { salonName, salonTypeCanonical, city, email, password, services } = result.data;

  const supabase = getSupabase();

  // ---- Step 1: create the Supabase auth user -----------------------------
  // email_confirm: true bypasses the email-verification round-trip for the
  // demo. In production this should be replaced with a magic-link invite.
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: salonName },
  });

  if (createErr || !created?.user) {
    const message = (createErr?.message || '').toLowerCase();
    if (
      message.includes('already registered') ||
      message.includes('already exists') ||
      message.includes('duplicate') ||
      message.includes('unique constraint')
    ) {
      log.warn({ owner_email: email }, 'auth user already exists — rejecting');
      return res
        .status(409)
        .json({ code: 'EMAIL_TAKEN', message: 'This email is already registered.' });
    }
    log.error(
      { err: createErr, owner_email: email },
      'failed to create auth user — returning 500',
    );
    return res
      .status(500)
      .json({ code: 'INTERNAL', message: 'Could not create account. Please try again.' });
  }
  const userId = created.user.id;
  log.info({ userId, owner_email: email }, 'auth user created');

  // ---- Step 2: confirm the auth trigger created the profile row ----------
  // The trigger (database/schema/04_auth_trigger.sql) auto-inserts a profiles
  // row on auth.users insert. We hard-check it because RLS policies in
  // 03_rls_policies.sql reference profiles.id for owner-only access; a
  // missing profile would brick the owner's login.
  const { data: profileRow, error: profileErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) {
    log.error({ err: profileErr, userId }, 'profile lookup failed — compensating');
    await compensateDeleteUser(userId, 'profile lookup failed');
    return res
      .status(500)
      .json({ code: 'INTERNAL', message: 'Profile setup failed. Please try again.' });
  }
  if (!profileRow) {
    log.error(
      { userId },
      'profile row not found after auth trigger — compensating deleteUser',
    );
    await compensateDeleteUser(userId, 'profile row missing post-trigger');
    return res.status(500).json({
      code: 'INTERNAL',
      message: 'Account setup is incomplete. Please contact support.',
    });
  }

  // ---- Step 3: create the businesses row ---------------------------------
  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .insert({
      name: salonName,
      business_type: salonTypeCanonical,
      city,
      owner_id: userId,
      // Phase 1 starts every trial in 'active' state. Phase 2 will add
      // trial_ends_at + soft-suspend after expiry.
      billing_state: 'active',
      agent_active: true,
    })
    .select('id, name')
    .single();

  if (bizErr || !biz) {
    log.error({ err: bizErr, userId }, 'failed to create businesses row — compensating');
    await compensateDeleteUser(userId, 'businesses insert failed');
    return res.status(500).json({
      code: 'INTERNAL',
      message: 'Could not create salon. Please try again.',
    });
  }
  const businessId = biz.id;
  log.info({ userId, businessId }, 'business row created');

  // ---- Step 4: batch-insert services -------------------------------------
  // Same row shape as the salon-portal dashboard's POST /services endpoint
  // (dashboard.ts:308) so the wizard can edit them with no shape mismatch.
  const serviceRows = services.map((s) => ({
    business_id: businessId,
    name: s.name,
    duration_minutes: s.duration_minutes,
    price: s.price ?? null,
    category: s.category ?? null,
    staff_required: 1,
    is_active: true,
  }));

  const { error: svcErr } = await supabase.from('services').insert(serviceRows);

  if (svcErr) {
    // We log and continue: services can be added from the dashboard after
    // login. Failing signup over a services-row bug would block the owner
    // from a real working account. The business row + auth user are intact.
    log.warn(
      { err: svcErr, businessId, serviceCount: serviceRows.length },
      'services batch insert failed (continuing) — owner can add services in dashboard',
    );
  } else {
    log.info(
      { businessId, serviceCount: serviceRows.length },
      'services batch inserted',
    );
  }

  // ---- Step 5: respond ---------------------------------------------------
  log.info(
    { userId, businessId, owner_email: email, serviceCount: serviceRows.length },
    'free-trial signup complete',
  );
  return res.status(201).json({ businessId, email });
});

export default router;
