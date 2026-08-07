import type {
  AuditEvent,
  Business,
  CreateSalonInput,
  KPI,
  OnboardingStatus,
  PaymentLog,
  RevenuePoint,
  SafetyRules,
  TierLimits,
} from "@/types";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Per-business dashboard row types — shape mirrors backend endpoints added
// in Phase 1 (backend/src/routes/dashboard.ts).
// ---------------------------------------------------------------------------

export interface StaffRow {
  id: string;
  name: string;
  phone: string | null;
  role: string | null;
  working_days: string | null;
  is_active: boolean;
  created_at: string;
  service_ids: string[];
}

export interface ServiceRow {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
  category: string | null;
  created_at: string;
}

export interface AppointmentRow {
  id: string;
  start_time: string;
  end_time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  source: string;
  customer: { id: string; phone: string; name: string | null } | null;
  service: { id: string; name: string; price: number | null; duration_minutes: number } | null;
  staff: { id: string; name: string } | null;
}

export interface NextAppointment {
  id: string;
  start_time: string;
  end_time: string;
  status: AppointmentRow["status"];
  service_name: string | null;
  staff_name: string | null;
}

/**
 * Story 18 — single row from the conversation thread endpoint.
 * `sender_type` matches the `message_sender` Postgres enum:
 *   'customer' | 'agent' | 'owner'
 */
export interface ConversationMessage {
  id: string;
  sender_type: "customer" | "agent" | "owner";
  content: string;
  created_at: string;
}

export interface EscalationRow {
  id: string;
  conversation_id: string;
  customer_name: string;
  customer_phone: string;
  reason: string;
  rule_label: string;
  rule_kind: string;
  ai_draft: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

export interface DashboardStats {
  kpis: {
    bookings_handled: number;
    conversations_processed: number;
    resolution_rate: number;
    revenue_pkr: number;
  };
  hourly: Array<{ h: string; c: number }>;
  intents: Array<{ name: string; value: number; color: string }>;
  feed: Array<{ text: string; tone: string; time: string }>;
}

export interface AIRules {
  rules: string[];
  triggers: { discounts: boolean; late: boolean; custom: boolean };
  discountMode: "decline" | "promo";
  latePolicy: string;
}

// ---------------------------------------------------------------------------
// HTTP client — thin fetch wrapper hitting the halo-backend. Falls back to
// deterministic mock data when the backend is not reachable so the dashboard
// stays useful in the Lovable preview.
//
// Auth: every request now attaches `Authorization: Bearer <jwt>` from the
// active Supabase session. The backend's requireAuth middleware verifies
// the token and applies per-role + per-business authorization.
// ---------------------------------------------------------------------------

const BASE_URL = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const superadminToken = typeof localStorage !== "undefined" ? localStorage.getItem("recepta.superadmin.token") : null;
  if (superadminToken) return { Authorization: `Bearer ${superadminToken}` };
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function withMock<T>(path: string, mock: () => T, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    // Loud-fail so broken wirings don't pass silently under mock fixtures.
    // Always log the swallowed error so the developer sees it.
    // Also re-throw when VITE_DISABLE_MOCK_FALLBACK=true so genuine
    // end-to-end tests fail loudly instead of seeing fixture data.
    // Default behavior (Lovable preview, no backend) is unchanged —
    // error is logged AND mock is returned.
    // eslint-disable-next-line no-console
    console.error(`[api] withMock fallback for ${path} — backend call failed:`, err);
    if (import.meta.env?.VITE_DISABLE_MOCK_FALLBACK === 'true') {
      throw err;
    }
    return mock();
  }
}

// ---------- Mock fixtures ---------------------------------------------------

const MOCK_SALONS: Business[] = [
  {
    id: "b1a1e6c2-1111-4a11-8000-000000000001",
    name: "Glow Studio Karachi",
    tier: "business",
    phone_number_id: "1043221109888",
    whatsapp_number: "923001234567",
    billing_status: "active",
    city: "Karachi",
    messages_month: 12480,
    mrr_pkr: 24000,
    agent_active: true,
    created_at: "2025-11-02T10:30:00Z",
  },
  {
    id: "b1a1e6c2-1111-4a11-8000-000000000002",
    name: "Lush Beauty Lounge",
    tier: "pro",
    phone_number_id: "1043221109889",
    whatsapp_number: "923219876543",
    billing_status: "grace_period",
    city: "Lahore",
    messages_month: 5320,
    mrr_pkr: 12000,
    agent_active: true,
    created_at: "2026-01-14T08:15:00Z",
  },
  {
    id: "b1a1e6c2-1111-4a11-8000-000000000003",
    name: "Serene Spa Islamabad",
    tier: "basic",
    whatsapp_number: "923335554411",
    billing_status: "active",
    city: "Islamabad",
    messages_month: 980,
    mrr_pkr: 4000,
    agent_active: true,
    created_at: "2026-03-22T12:00:00Z",
  },
  {
    id: "b1a1e6c2-1111-4a11-8000-000000000004",
    name: "Nova Nails Bar",
    tier: "pro",
    whatsapp_number: "923452223311",
    billing_status: "suspended",
    city: "Karachi",
    messages_month: 0,
    mrr_pkr: 0,
    agent_active: false,
    created_at: "2026-04-01T09:00:00Z",
  },
  {
    id: "b1a1e6c2-1111-4a11-8000-000000000005",
    name: "Aura Salon & Spa",
    tier: "business",
    phone_number_id: "1043221109890",
    whatsapp_number: "923011119999",
    billing_status: "active",
    city: "Lahore",
    messages_month: 18220,
    mrr_pkr: 24000,
    agent_active: true,
    created_at: "2025-08-10T14:20:00Z",
  },
];

const MOCK_AUDIT: AuditEvent[] = [
  {
    id: "a1",
    business_id: MOCK_SALONS[0].id,
    business_name: MOCK_SALONS[0].name,
    kind: "booking",
    summary: "Booking confirmed — Haircut · Sat 18:00",
    created_at: new Date(Date.now() - 60_000 * 3).toISOString(),
  },
  {
    id: "a2",
    business_id: MOCK_SALONS[1].id,
    business_name: MOCK_SALONS[1].name,
    kind: "billing",
    summary: "Payment retry failed — moved to grace_period",
    created_at: new Date(Date.now() - 60_000 * 12).toISOString(),
  },
  {
    id: "a3",
    business_id: MOCK_SALONS[4].id,
    business_name: MOCK_SALONS[4].name,
    kind: "message",
    summary: "LLM agent responded to 42 conversations in last hour",
    created_at: new Date(Date.now() - 60_000 * 28).toISOString(),
  },
  {
    id: "a4",
    business_id: MOCK_SALONS[2].id,
    business_name: MOCK_SALONS[2].name,
    kind: "system",
    summary: "WhatsApp Web session re-paired via QR",
    created_at: new Date(Date.now() - 60_000 * 55).toISOString(),
  },
  {
    id: "a5",
    business_id: MOCK_SALONS[3].id,
    business_name: MOCK_SALONS[3].name,
    kind: "billing",
    summary: "Tenant suspended — non-payment >14 days",
    created_at: new Date(Date.now() - 60_000 * 90).toISOString(),
  },
];

const MOCK_REVENUE: RevenuePoint[] = [
  { month: "Feb", revenue: 184000 },
  { month: "Mar", revenue: 212000 },
  { month: "Apr", revenue: 248000 },
  { month: "May", revenue: 265000 },
  { month: "Jun", revenue: 289000 },
  { month: "Jul", revenue: 312000 },
];

const MOCK_PAYMENTS: PaymentLog[] = [
  {
    id: "p1",
    business_name: "Glow Studio Karachi",
    amount_pkr: 24000,
    status: "paid",
    method: "Card",
    created_at: "2026-07-22T09:12:00Z",
  },
  {
    id: "p2",
    business_name: "Aura Salon & Spa",
    amount_pkr: 24000,
    status: "paid",
    method: "Bank",
    created_at: "2026-07-21T14:04:00Z",
  },
  {
    id: "p3",
    business_name: "Lush Beauty Lounge",
    amount_pkr: 12000,
    status: "failed",
    method: "Card",
    created_at: "2026-07-20T08:30:00Z",
  },
  {
    id: "p4",
    business_name: "Serene Spa Islamabad",
    amount_pkr: 4000,
    status: "pending",
    method: "JazzCash",
    created_at: "2026-07-19T16:45:00Z",
  },
  {
    id: "p5",
    business_name: "Nova Nails Bar",
    amount_pkr: 12000,
    status: "failed",
    method: "Card",
    created_at: "2026-07-15T10:10:00Z",
  },
];

const MOCK_TIER_LIMITS: TierLimits[] = [
  { tier: "basic", monthlyMessages: 2000, concurrentAgents: 1, pricePKR: 4000 },
  { tier: "pro", monthlyMessages: 10000, concurrentAgents: 3, pricePKR: 12000 },
  { tier: "business", monthlyMessages: 50000, concurrentAgents: 10, pricePKR: 24000 },
];

const MOCK_SAFETY: SafetyRules = {
  hard: [
    "Never quote prices not present in the salon's catalog",
    "Never confirm bookings outside declared business hours",
    "Never share another customer's personal details",
  ],
  soft: [
    "Prefer replies under 40 words",
    "Escalate to human on 2 consecutive misunderstandings",
    "Suggest upsells at most once per conversation",
  ],
};

// ---------- API surface ----------------------------------------------------

export const api = {
  listSalons: () => withMock("/api/salons", () => MOCK_SALONS),
  createSalon: (input: CreateSalonInput) =>
    withMock(
      "/api/salons",
      () => ({
        ...MOCK_SALONS[0],
        id: crypto.randomUUID(),
        name: input.name,
        tier: input.tier,
        whatsapp_number: input.whatsappNumber,
        phone_number_id: input.phoneNumberId,
        city: input.city,
        billing_status: "active" as const,
        messages_month: 0,
        mrr_pkr: 0,
        created_at: new Date().toISOString(),
      }),
      { method: "POST", body: JSON.stringify(input) },
    ),
  updateSalon: (id: string, patch: Partial<Business>) =>
    withMock<Business>(`/api/salons/${id}`, () => ({ ...MOCK_SALONS[0], ...patch, id }), {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteSalon: (id: string) =>
    withMock<{ id: string }>(
      `/api/salons/${id}`,
      () => {
        const idx = MOCK_SALONS.findIndex((s) => s.id === id);
        if (idx !== -1) MOCK_SALONS.splice(idx, 1);
        return { id };
      },
      { method: "DELETE" },
    ),
  setAgentActive: (id: string, active: boolean) =>
    withMock<Business>(
      `/api/salons/${id}/agent`,
      () => {
        const idx = MOCK_SALONS.findIndex((s) => s.id === id);
        if (idx === -1) throw new Error("Salon not found");
        const salon = MOCK_SALONS[idx];
        // Hard rule: a suspended tenant's agent can never be flipped on from
        // this toggle — reactivation must go through the billing flow.
        const nextActive = salon.billing_status === "suspended" ? false : active;
        MOCK_SALONS[idx] = { ...salon, agent_active: nextActive };
        return MOCK_SALONS[idx];
      },
      { method: "PATCH", body: JSON.stringify({ active }) },
    ),
  auditStream: () => withMock("/api/audit", () => MOCK_AUDIT),
  kpis: (): Promise<KPI> =>
    withMock("/api/kpis", () => ({
      messagesDelivered: 128420,
      revenuePKR: 312000,
      pendingCases: 7,
      activeSalons: MOCK_SALONS.filter((s) => s.billing_status === "active").length,
    })),
  revenueSeries: () => withMock("/api/revenue", () => MOCK_REVENUE),
  payments: () => withMock("/api/payments", () => MOCK_PAYMENTS),
  tierLimits: () => withMock("/api/settings/tiers", () => MOCK_TIER_LIMITS),
  updateTierLimits: (rows: TierLimits[]) =>
    withMock("/api/settings/tiers", () => rows, {
      method: "PATCH",
      body: JSON.stringify(rows),
    }),
  safetyRules: () => withMock("/api/settings/safety", () => MOCK_SAFETY),
  updateSafetyRules: (rules: SafetyRules) =>
    withMock("/api/settings/safety", () => rules, {
      method: "PATCH",
      body: JSON.stringify(rules),
    }),
  onboardingStatus: (businessId: string): Promise<OnboardingStatus> =>
    withMock(`/onboarding/${businessId}/status`, () => ({
      businessId,
      status: "qr_ready",
      hasQR: true,
      qr: null,
    })),
  connectionInfo: (businessId: string) =>
    withMock(`/api/business/${businessId}/connection-info`, () => ({
      businessId,
      phone_number_id_set: false,
      qr_pairing_available: true,
      agent_active: false,
      instructions:
        "Scan the QR code with your salon WhatsApp to start receiving customer messages.",
      next_step: "scan_qr" as const,
    })),
  registerOnboarding: (businessId: string) =>
    withMock(`/onboarding/${businessId}/register`, () => ({ ok: true }), {
      method: "POST",
    }),
  onboardingPageUrl: (businessId: string) =>
    `${BASE_URL}/onboarding/${businessId}`,

  // ---- Phase 1 dashboard wiring (round-trip data) -----------------------

  staff: (businessId: string) =>
    withMock(`/api/business/${businessId}/staff`, () => ({ staff: [] as StaffRow[] })),

  conversations: (businessId: string) =>
    withMock(`/api/business/${businessId}/conversations`, () => ({
      conversations: [] as Array<{
        id: string;
        status: string;
        last_message_at: string;
        created_at: string;
        customer: { id: string; phone: string; name: string | null } | null;
        state: {
          current_intent: string | null;
          last_customer_msg: string | null;
          last_agent_msg: string | null;
          outcome: string | null;
        } | null;
        next_appointment: NextAppointment | null;
      }>,
    })),

  /**
   * Story 18 — full chronological thread for one conversation. Used by
   * the inbox detail panel to render every customer/agent/owner turn.
   * Returns [] on backend error rather than throwing, so a transient
   * failure doesn't blow away the conversation list.
   */
  conversationMessages: (conversationId: string) =>
    withMock<{
      conversationId: string;
      messages: ConversationMessage[];
    }>(`/api/conversations/${conversationId}/messages`, () => ({
      conversationId,
      messages: [] as ConversationMessage[],
    })),

  /**
   * Wave 2 — owner clicks "Mark Resolved" on an escalation. Flips
   * escalation_events.resolved=true; the conversation drops out of
   * the Active sub-tab automatically on the next refresh.
   */
  resolveEscalation: (escalationId: string) =>
    withMock<{ id: string; resolved: boolean; alreadyResolved?: boolean }>(
      `/api/escalations/${escalationId}/resolve`,
      () => ({ id: escalationId, resolved: true }),
      { method: "POST" },
    ),

  /**
   * Wave 2 — owner-driven manual send. The backend persists the owner
   * turn to messages FIRST, then proxies the actual WhatsApp send to
   * the bridge. Returns sentToBridge=false when the bridge is down —
   * the messages row is still saved, so the owner can re-send.
   */
  ownerReply: (
    conversationId: string,
    text: string,
  ) =>
    withMock<{
      ok: boolean;
      sentToBridge: boolean;
      messageId: string | null;
    }>(
      `/api/conversations/${conversationId}/owner-reply`,
      () => ({ ok: false, sentToBridge: false, messageId: null }),
      { method: "POST", body: JSON.stringify({ text }) },
    ),

  /**
   * Wave 2 — Resolved sub-tab. Returns conversations whose latest
   * escalation has resolved=true (sorted by resolved_at desc). Same
   * row shape as the active list endpoint so the existing renderer
   * works unchanged.
   */
  resolvedEscalations: (businessId: string) =>
    withMock<{
      conversations: Array<{
        id: string;
        status: string;
        last_message_at: string;
        customer: { id: string; name: string | null; phone: string | null };
        state: {
          current_intent: string | null;
          last_customer_msg: string | null;
          last_agent_msg: string | null;
          outcome: string | null;
        };
        /** ISO timestamp from escalation_events.resolved_at — drives
         *  the row's "Resolved Xh ago" display label. */
        resolved_at: string | null;
        next_appointment: unknown | null;
      }>;
    }>(`/api/business/${businessId}/resolved-escalations`, () => ({
      conversations: [],
    })),

  /**
   * Story 13 — owner-side kill switch. Flips the salon's agent_active
   * column. Distinct from setAgentActive() (which is superadmin-only —
   * hits /api/salons/:id/agent). When active=false the backend stops
   * the bot from replying, but customer messages are still persisted
   * to the messages table so the owner can read them in the inbox.
   */
  setMyAgentActive: (businessId: string, active: boolean) =>
    withMock<{ id: string; agent_active: boolean }>(
      `/api/business/${businessId}/agent-active`,
      () => ({ id: businessId, agent_active: active }),
      {
        method: "PATCH",
        body: JSON.stringify({ agent_active: active }),
      },
    ),

  /**
   * Story 13 — read the owner's current agent_active state. Used by
   * the toggle to render its initial state without pulling the full
   * business row.
   */
  getMyAgentActive: (businessId: string) =>
    withMock<{ id: string; agent_active: boolean }>(
      `/api/business/${businessId}/agent-active`,
      () => ({ id: businessId, agent_active: true }),
    ),

  services: (businessId: string) =>
    withMock(`/api/business/${businessId}/services`, () => ({
      services: [] as ServiceRow[],
    })),

  // ---- Wave 1 dashboard wiring -------------------------------------------

  /** Today's bookings (Asia/Karachi day). Auto-refreshes every 60s. */
  businessToday: (businessId: string) =>
    withMock(`/api/business/${businessId}/today`, () => ({
      appointments: [] as AppointmentRow[],
    })),

  /** Bookings for a specific date. Pass date as YYYY-MM-DD. */
  businessBookings: (businessId: string, date: string) =>
    withMock(
      `/api/business/${businessId}/bookings?date=${encodeURIComponent(date)}`,
      () => ({
        date,
        appointments: [] as AppointmentRow[],
      }),
    ),

  /** Create a new service. Backend accepts category since 13_salon_portal_fields. */
  createService: (
    businessId: string,
    body: {
      name: string;
      duration_minutes: number;
      price?: number;
      category?: string;
    },
  ) =>
    withMock<{ service: ServiceRow }>(
      `/api/business/${businessId}/services`,
      () => ({
        service: {
          id: crypto.randomUUID(),
          name: body.name,
          price: body.price ?? 0,
          duration_minutes: body.duration_minutes,
          category: body.category ?? null,
          created_at: new Date().toISOString(),
        },
      }),
      { method: "POST", body: JSON.stringify(body) },
    ),

  /** Edit a service. Backend accepts a partial body. */
  updateService: (
    businessId: string,
    serviceId: string,
    body: Partial<{
      name: string;
      duration_minutes: number;
      price: number;
      category: string | null;
      is_active: boolean;
    }>,
  ) =>
    withMock<{ service: ServiceRow }>(
      `/api/business/${businessId}/services/${serviceId}`,
      () => ({
        service: {
          id: serviceId,
          name: body.name ?? "",
          price: body.price ?? 0,
          duration_minutes: body.duration_minutes ?? 0,
          category: body.category ?? null,
          created_at: new Date().toISOString(),
        },
      }),
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  /** Create new staff, optionally with skills assigned at creation. */
  createStaff: (
    businessId: string,
    body: { name: string; phone?: string; skill_service_ids?: string[] },
  ) =>
    withMock<{ staff: StaffRow & { id: string; name: string; phone: string | null; is_active: boolean; created_at: string } }>(
      `/api/business/${businessId}/staff`,
      () => ({
        staff: {
          id: crypto.randomUUID(),
          name: body.name,
          phone: body.phone ?? null,
          role: null,
          working_days: null,
          is_active: true,
          created_at: new Date().toISOString(),
          service_ids: body.skill_service_ids ?? [],
        },
      }),
      { method: "POST", body: JSON.stringify(body) },
    ),

  /** Edit a staff record. Partial body — name/role/working_days/phone/is_active. */
  updateStaff: (
    businessId: string,
    staffId: string,
    body: Partial<{
      name: string;
      role: string | null;
      working_days: string | null;
      phone: string | null;
      is_active: boolean;
    }>,
  ) =>
    withMock<{ staff: StaffRow }>(
      `/api/business/${businessId}/staff/${staffId}`,
      () => ({
        staff: {
          id: staffId,
          name: body.name ?? "",
          phone: body.phone ?? null,
          role: body.role ?? null,
          working_days: body.working_days ?? null,
          is_active: body.is_active ?? true,
          created_at: new Date().toISOString(),
          service_ids: [],
        },
      }),
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  /** Replace the staff's skill set with the given service IDs. */
  setStaffSkills: (staffId: string, serviceIds: string[]) =>
    withMock<{ staff_id: string; service_ids: string[] }>(
      `/api/staff/${staffId}/skills`,
      () => ({ staff_id: staffId, service_ids: serviceIds }),
      { method: "PATCH", body: JSON.stringify({ service_ids: serviceIds }) },
    ),

  /** Patch an appointment — confirm/cancel/reschedule. */
  patchAppointment: (
    appointmentId: string,
    body: {
      status?: "pending" | "confirmed" | "completed" | "cancelled";
      start_time?: string;
      end_time?: string;
    },
  ) =>
    withMock<{ appointment: AppointmentRow }>(
      `/api/appointments/${appointmentId}`,
      () => ({
        appointment: {
          id: appointmentId,
          start_time: new Date().toISOString(),
          end_time: new Date().toISOString(),
          status: body.status ?? "pending",
          source: "owner_manual",
          customer: null,
          service: null,
          staff: null,
        },
      }),
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  dashboardStats: (businessId: string) =>
    withMock(`/api/business/${businessId}/dashboard-stats`, () => ({
      kpis: {
        bookings_handled: 0,
        conversations_processed: 0,
        resolution_rate: 0,
        revenue_pkr: 0,
      },
      hourly: [] as Array<{ h: string; c: number }>,
      intents: [] as Array<{ name: string; value: number; color: string }>,
      feed: [] as Array<{ text: string; tone: string; time: string }>,
    })),

  escalations: (businessId: string) =>
    withMock(`/api/business/${businessId}/escalations`, () => ({
      escalations: [] as EscalationRow[],
    })),

  aiRules: (businessId: string) =>
    withMock(`/api/business/${businessId}/ai-rules`, () => ({
      rules: [] as string[],
      triggers: { discounts: true, late: true, custom: true },
      discountMode: "promo" as "decline" | "promo",
      latePolicy:
        "If a customer is more than 15 minutes late, offer to reschedule or hold the slot for 5 more minutes.",
    })),

  updateAiRules: (
    businessId: string,
    body: {
      rules: string[];
      triggers: { discounts: boolean; late: boolean; custom: boolean };
      discountMode: "decline" | "promo";
      latePolicy: string;
    },
  ) =>
    withMock(
      `/api/business/${businessId}/ai-rules`,
      () => body,
      { method: "PUT", body: JSON.stringify(body) },
    ),
};

export const qk = {
  salons: ["salons"] as const,
  audit: ["audit"] as const,
  kpis: ["kpis"] as const,
  revenue: ["revenue"] as const,
  payments: ["payments"] as const,
  tierLimits: ["settings", "tiers"] as const,
  safety: ["settings", "safety"] as const,
  onboarding: (id: string) => ["onboarding", id] as const,
  staff: (id: string) => ["staff", id] as const,
  conversations: (id: string) => ["conversations", id] as const,
  conversationMessages: (id: string) =>
    ["conversations", id, "messages"] as const,
  resolvedEscalations: (id: string) =>
    ["resolved-escalations", id] as const,
  myAgentActive: (id: string) =>
    ["agent-active", id] as const,
  services: (id: string) => ["services", id] as const,
  dashboardStats: (id: string) => ["dashboard-stats", id] as const,
  escalations: (id: string) => ["escalations", id] as const,
  aiRules: (id: string) => ["ai-rules", id] as const,
  businessToday: (id: string) => ["bookings", "today", id] as const,
  businessBookings: (id: string, date: string) =>
    ["bookings", "date", id, date] as const,
};
