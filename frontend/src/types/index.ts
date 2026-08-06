export type Tier = "basic" | "pro" | "business";
export type BillingStatus = "active" | "grace_period" | "suspended";

export interface Business {
  id: string;
  name: string;
  tier: Tier;
  phone_number_id?: string;
  whatsapp_number: string;
  billing_status: BillingStatus;
  city?: string;
  messages_month?: number;
  mrr_pkr?: number;
  agent_active?: boolean;
  created_at: string;
}

export interface HandleResult {
  reply: string | null;
  conversationId: string | null;
  customerId: string | null;
}

export interface AuditEvent {
  id: string;
  business_id: string;
  business_name: string;
  kind: "message" | "booking" | "billing" | "system";
  summary: string;
  created_at: string;
}

export interface KPI {
  messagesDelivered: number;
  revenuePKR: number;
  pendingCases: number;
  activeSalons: number;
}

export interface RevenuePoint {
  month: string;
  revenue: number;
}

export interface PaymentLog {
  id: string;
  business_name: string;
  amount_pkr: number;
  status: "paid" | "pending" | "failed";
  method: string;
  created_at: string;
}

export interface TierLimits {
  tier: Tier;
  monthlyMessages: number;
  concurrentAgents: number;
  pricePKR: number;
}

export interface SafetyRules {
  hard: string[];
  soft: string[];
}

export interface OnboardingStatus {
  businessId: string;
  status: "qr_ready" | "ready" | "initializing" | "not_found";
  hasQR: boolean;
  /** Raw QR string from whatsapp-web bridge. Encode with qrcode.react. */
  qr: string | null;
}

export interface CreateSalonInput {
  name: string;
  tier: Tier;
  phoneNumberId?: string;
  systemAccessToken?: string;
  whatsappNumber: string;
  city?: string;
}
