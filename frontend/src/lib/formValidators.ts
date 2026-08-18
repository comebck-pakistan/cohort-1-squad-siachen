// ---------------------------------------------------------------------------
// Shared form validators — Wave 16.
//
// Single source of truth for the per-field rules used by the public
// payment form (/payment) and the free-trial signup wizard
// (/onboarding). Each validator returns:
//   - `null`            when the value is valid (or empty and not required)
//   - `string`          a short, customer-facing error message when invalid
//
// We deliberately keep the messages concrete ("example: 0300 1234567")
// rather than generic ("invalid input") so the owner can self-correct
// without having to guess what the rule is. The accompanying UI layer
// (FieldErrorLabel) renders these strings in red below the input.
//
// The "showError" pattern is the silent-disabled replacement:
//   - We let the user submit the form even when fields are invalid.
//   - On submit, we run validate() and set per-field errors.
//   - The submit button stays enabled at all times (only disabled while
//     the network request is in flight), so the user always sees a
//     clear "what's wrong" instead of a button that just refuses to
//     work.
// ---------------------------------------------------------------------------

// Same regex the backend uses (lib/auth.ts signup validator + Stripe-style
// email check). Allows +, dots, hyphens in local part; requires an @ and a
// TLD. Intentionally permissive — the goal is to catch obvious typos, not
// to enforce RFC 5322.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pakistani phone numbers are 10 digits (PTCL) or 12 with the +92 country
// code for mobile. We accept 10-15 digits after stripping spaces, dashes,
// parens and a leading 0. This is the same input the user types, so we
// don't keep the dial prefix in the count — we only count digits.
export const PHONE_DIGITS_MIN = 10;
export const PHONE_DIGITS_MAX = 15;

export function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()+]/g, "").replace(/^0+/, "");
}

export function validateEmail(value: string, required: boolean = true): string | null {
  const v = value.trim();
  if (v.length === 0) {
    return required ? "Email is required" : null;
  }
  if (!EMAIL_RE.test(v)) {
    return "Use the format name@example.com";
  }
  return null;
}

export function validatePhone(
  value: string,
  required: boolean = true,
): string | null {
  const v = value.trim();
  if (v.length === 0) {
    return required ? "Phone number is required" : null;
  }
  const digits = normalizePhone(v);
  if (!/^\d+$/.test(digits)) {
    return "Phone must contain digits only";
  }
  if (digits.length < PHONE_DIGITS_MIN || digits.length > PHONE_DIGITS_MAX) {
    return `Phone must be ${PHONE_DIGITS_MIN}-${PHONE_DIGITS_MAX} digits (e.g. 0300 1234567)`;
  }
  return null;
}

export function validateNotEmpty(
  value: string,
  fieldLabel: string,
  required: boolean = true,
): string | null {
  if (value.trim().length === 0) {
    return required ? `${fieldLabel} is required` : null;
  }
  return null;
}

// Optional phone — same digit rules but missing is OK.
export function validatePhoneOptional(value: string): string | null {
  return validatePhone(value, false);
}
