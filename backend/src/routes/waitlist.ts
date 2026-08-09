// ---------------------------------------------------------------------------
// Waitlist signup — Wave 8 (landing-page honesty pass).
//
// Public POST endpoint that captures early-access interest from the
// landing-page hero. Replaces the prior "Get Started" CTA as the primary
// lead-generation path while we're still in early access and not running
// self-serve payment.
//
// One POST captures one lead:
//   1. Validate the body (name + salon_name + phone + email required,
//      salon_type optional).
//   2. Insert into public.waitlist_leads via the service-role Supabase
//      key (RLS is bypassed; the migration also has no anon INSERT
//      policy so direct Supabase REST calls can't spam leads).
//   3. Return 201 with the lead id, or 400 with a validation message.
//
// No auth — same shape as free-trial-signup. Public. The hero form on
// the landing page is the only intended caller for now.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { childLogger } from '../lib/logger';

const router = Router();
const log = childLogger('waitlist');

// ---- Types -----------------------------------------------------------------

interface WaitlistBody {
  name?: unknown;
  salonName?: unknown;
  phone?: unknown;
  email?: unknown;
  salonType?: unknown;
}

// Matches the wizard's salon-type dropdown (free-trial-signup.ts:60-66).
// Keep the keys in sync — the hero form's <select> uses the same labels.
const SALON_TYPES = [
  'Hair Salon',
  'Nail Bar',
  'MedSpa',
  'Barbershop',
  'Lash & Brow Studio',
] as const;
type SalonType = typeof SALON_TYPES[number];

// ---- Validation ------------------------------------------------------------

interface ValidationOk {
  ok: true;
  data: {
    name: string;
    salonName: string;
    phone: string;
    email: string;
    salonType: string | null;
  };
}
interface ValidationErr {
  ok: false;
  message: string;
}

function validate(body: WaitlistBody): ValidationOk | ValidationErr {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const salonName = typeof body.salonName === 'string' ? body.salonName.trim() : '';
  // Phone: strip formatting the way the wizard does (defensive — the
  // frontend should already strip, but a curl/Postman caller might not).
  const phoneRaw = typeof body.phone === 'string' ? body.phone : '';
  const phone = phoneRaw.replace(/[\s\-()+]/g, '').replace(/^0+/, '');
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const salonTypeRaw =
    typeof body.salonType === 'string' && body.salonType.trim().length > 0
      ? body.salonType.trim()
      : null;
  const salonType =
    salonTypeRaw && (SALON_TYPES as readonly string[]).includes(salonTypeRaw)
      ? salonTypeRaw
      : null;

  if (name.length < 2) {
    return { ok: false, message: 'name must be at least 2 characters' };
  }
  if (salonName.length < 2) {
    return { ok: false, message: 'salonName must be at least 2 characters' };
  }
  // Same digit range as free-trial-signup.ts:128 — 10-15 digits covers
  // PK mobile (12 with country code) and the international ceiling.
  if (!/^\d{10,15}$/.test(phone)) {
    return {
      ok: false,
      message:
        'phone must be 10-15 digits (with country code, no + or spaces)',
    };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'email format is invalid' };
  }
  // salonType is optional; if provided it must be one of the canonical
  // labels. An unknown value gets null'd silently (logged below).
  if (salonTypeRaw && !salonType) {
    return {
      ok: false,
      message: `salonType must be one of: ${SALON_TYPES.join(', ')}`,
    };
  }

  return { ok: true, data: { name, salonName, phone, email, salonType } };
}

// ---- Handler ---------------------------------------------------------------

router.post('/waitlist', async (req: Request, res: Response) => {
  const result = validate(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ code: 'VALIDATION', message: result.message });
  }
  const { name, salonName, phone, email, salonType } = result.data;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('waitlist_leads')
    .insert({
      name,
      salon_name: salonName,
      phone,
      email,
      salon_type: salonType,
    })
    .select('id')
    .single();

  if (error || !data) {
    // Most likely cause: unique constraint on (phone, email) if we add
    // one later. For now, just log + 500. The migration has no unique
    // constraint so duplicate inserts succeed — handled in the frontend
    // with a "you're already on the list" success toast.
    log.error(
      { err: error?.message, email, phone },
      'waitlist insert failed'
    );
    return res.status(500).json({
      code: 'INTERNAL',
      message: 'Could not save your details. Please try again.',
    });
  }

  log.info(
    { leadId: data.id, salonName, salonType, hasPhone: true, hasEmail: true },
    'waitlist lead captured'
  );
  return res.status(201).json({ leadId: data.id });
});

export default router;