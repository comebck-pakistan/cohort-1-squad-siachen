// =====================================================================
// Predefined rules + escalation triggers (Wave 9).
//
// The vocabulary here is owned by the PLATFORM (us), not by the salon
// owner. The owner can only toggle which rules are enabled for their
// salon — they cannot edit the rule text. This is the same shape as
// the platform command "we define it, you opt in".
//
// To add a new rule or trigger:
//   1. Add an entry below.
//   2. Deploy the backend (the new key is now valid for inserts).
//   3. The frontend renders the new toggle automatically because it
//      reads this vocabulary at render time.
// =====================================================================

// ---------------------------------------------------------------------------
// Rules — owner-facing toggle list. The label is shown in the UI; the
// prose is injected into the LLM system prompt when the rule is enabled.
// Keep prose short, directive, and receptionist-toned. The LLM reads these
// prose blocks as binding instructions (see buildSystemPrompt in llm.ts).
// ---------------------------------------------------------------------------

export interface PredefinedRule {
  key: string;
  label: string;
  prose: string;
}

export const PREDEFINED_RULES: Record<string, PredefinedRule> = {
  discount_decline: {
    key: 'discount_decline',
    label: 'Strictly decline discount requests',
    prose:
      'If the customer asks for a discount, coupon, or any price reduction, politely decline. Do NOT offer promo codes, negotiate, or suggest alternative discounts. Steer back to the standard service menu.',
  },
  discount_promo: {
    key: 'discount_promo',
    label: 'Offer WELCOME10 to new customers',
    prose:
      'If the customer asks for a discount or seems price-sensitive, offer the WELCOME10 code once per conversation (10% off their first booking). If they ask again, repeat the same offer — do not stack or escalate.',
  },
  late_arrival_15min: {
    key: 'late_arrival_15min',
    label: '15-minute late tolerance',
    prose:
      'If the customer is more than 15 minutes late for their appointment, explain politely that the slot cannot be held and offer to reschedule. Tolerate up to 15 minutes — past that, ask them to rebook.',
  },
  late_arrival_30min: {
    key: 'late_arrival_30min',
    label: '30-minute late tolerance',
    prose:
      'If the customer is more than 30 minutes late for their appointment, explain politely that the slot cannot be held and offer to reschedule.',
  },
  refund_48h: {
    key: 'refund_48h',
    label: '48-hour refund window',
    prose:
      'Only honor refund requests made within 48 hours of the appointment. If the request is older than 48 hours, politely decline and offer a future discount instead.',
  },
  refund_full: {
    key: 'refund_full',
    label: 'Honor refund requests fully',
    prose:
      'Honor all refund requests without question. If the customer is upset, escalate to the owner.',
  },
  no_double_booking: {
    key: 'no_double_booking',
    label: 'No double-booking same stylist',
    prose:
      'Never book two customers with the same stylist at overlapping times. If a customer requests a conflicting time, offer the next available slot with that stylist or any other available stylist.',
  },
  min_24h_advance: {
    key: 'min_24h_advance',
    label: 'Require 24h advance booking',
    prose:
      'Do not accept bookings less than 24 hours in advance. If the customer requests a same-day or next-day booking, politely explain that the schedule requires 24 hours notice and offer the next available slot.',
  },
  no_medical_advice: {
    key: 'no_medical_advice',
    label: 'Never give medical/skin/health advice',
    prose:
      'Never give medical, skin, or health advice. If the customer describes a symptom (rash, infection, swelling, pain, allergic reaction), asks "is this safe for [pregnancy / kids / sensitive skin]", or mentions pregnancy/nursing in the context of a service, do NOT diagnose, recommend a product, or confirm a booking. Acknowledge briefly and tell them the team will follow up.',
  },
};

export const PREDEFINED_RULE_KEYS = Object.keys(PREDEFINED_RULES);

export function isValidRuleKey(key: string): boolean {
  return key in PREDEFINED_RULES;
}

// ---------------------------------------------------------------------------
// Escalation triggers — same pattern but the prose is shorter; it's a
// directive to escalate, not a behavioral rule. The LLM sees one of these
// in the prompt and the behavior is "set intent=escalate and tell the
// customer a team member will follow up".
// ---------------------------------------------------------------------------

export interface PredefinedTrigger {
  key: string;
  label: string;
  prose: string;
}

export const PREDEFINED_TRIGGERS: Record<string, PredefinedTrigger> = {
  complaint: {
    key: 'complaint',
    label: 'Customer mentions a complaint or bad experience',
    prose:
      'If the customer mentions a complaint, bad experience, or expresses unhappiness, set intent="escalate" and tell them a team member will follow up shortly.',
  },
  ownerNumber: {
    key: 'ownerNumber',
    label: "Customer asks for the owner's personal number",
    prose:
      "If the customer explicitly asks for the owner's personal phone number, set intent=\"escalate\" and tell them you will have the team reach out.",
  },
  twoMisunderstands: {
    key: 'twoMisunderstands',
    label: 'AI fails to understand 2 turns in a row',
    prose:
      'If you have not understood the customer\'s intent for 2 consecutive turns, set intent="escalate" and offer to connect with a team member.',
  },
  refund: {
    key: 'refund',
    label: 'Customer requests a refund',
    prose:
      'If the customer mentions refund, money back, chargeback, or disputes payment, set intent="escalate" and tell them a team member will follow up.',
  },
  afterHours: {
    key: 'afterHours',
    label: 'Booking requested outside operating hours',
    prose:
      'If the customer requests a booking at a time outside the salon\'s operating hours, set intent="escalate" and tell them the team will follow up to discuss alternative options.',
  },
};

export const PREDEFINED_TRIGGER_KEYS = Object.keys(PREDEFINED_TRIGGERS);

export function isValidTriggerKey(key: string): boolean {
  return key in PREDEFINED_TRIGGERS;
}
