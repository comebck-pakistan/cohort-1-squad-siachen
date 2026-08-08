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
  status:
    | "initializing"
    | "qr_pending"
    | "qr_ready"
    | "code_pending"
    | "authenticated"
    | "ready"
    | "disconnected"
    | "expired"
    | "not_found";
  hasQR: boolean;
  /** Raw QR string from whatsapp-web bridge. Encode with qrcode.react.
   *  Always null when pairing_method === 'phone' — phone mode clears
   *  the QR holder on the bridge side. */
  qr: string | null;
  /** Which pairing handshake the salon owner picked. 'qr' (default,
   *  scans an image) or 'phone' (types an 8-char code under
   *  Settings → Linked Devices). null when no client is registered. */
  pairing_method: "qr" | "phone" | null;
  /** Raw 8-char pairing code from the library, no dashes
   *  (e.g. "ABCDEFGH"). Modal formats as XXXX-XXXX for display.
   *  Only populated when status === 'code_pending'. */
  pairing_code: string | null;
}

export interface CreateSalonInput {
  name: string;
  tier: Tier;
  phoneNumberId?: string;
  systemAccessToken?: string;
  whatsappNumber: string;
  city?: string;
}
