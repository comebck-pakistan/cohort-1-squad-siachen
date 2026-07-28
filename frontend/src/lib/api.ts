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
  } catch {
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
    })),
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
};
