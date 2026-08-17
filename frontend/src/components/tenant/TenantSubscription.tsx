import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  Check,
  CreditCard,
  MessageCircle,
  MessagesSquare,
  Mic,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { api, qk } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /salon-portal/subscription — Wave 14
//
// Salon-owner-facing composite view of their plan + billing + features.
// Reads `GET /api/business/:id/subscription` (single round-trip joins
// businesses + plans + last approved payment + trial info).
//
// Three stacked sections:
//   1. Plan header — TierBadge, name, monthly price, description, status
//   2. Billing card — next billing date, payment method, last payment
//   3. Features grid — 5 known feature flags (whatsapp_ai, voice_notes,
//      escalations, multi_staff, analytics) with check/X indicators +
//      Upgrade CTA when not on active Pro.
// ---------------------------------------------------------------------------

type SubscriptionStatus =
  | "trial"
  | "trialing"
  | "active"
  | "expired"
  | "cancelled"
  | "pending_payment"
  | "none";

type FeatureDef = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  proOnly?: boolean;
};

const KNOWN_FEATURES: FeatureDef[] = [
  {
    key: "whatsapp_ai",
    icon: MessageCircle,
    label: "WhatsApp AI receptionist",
    description:
      "24/7 automated replies to customer messages on your WhatsApp number",
  },
  {
    key: "voice_notes",
    icon: Mic,
    label: "Voice-note transcription",
    description:
      "Customers can send Roman-Urdu voice notes; Recepta transcribes and replies",
    proOnly: true,
  },
  {
    key: "escalations",
    icon: MessagesSquare,
    label: "Customer escalations",
    description:
      "Edge-case conversations surfaced to your Inbox for manual reply",
  },
  {
    key: "multi_staff",
    icon: Users,
    label: "Multi-staff support",
    description:
      "Add your team, set skills, and route bookings to the right person",
    proOnly: true,
  },
  {
    key: "analytics",
    icon: BarChart3,
    label: "Analytics dashboard",
    description:
      "Hourly volume, conversion rate, and revenue trends every month",
    proOnly: true,
  },
];

const SUBSCRIPTION_BADGE: Record<
  SubscriptionStatus,
  { label: string; className: string }
> = {
  trial: {
    label: "Trial",
    className: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  },
  trialing: {
    label: "Trial",
    className: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  },
  active: {
    label: "Active",
    className: "bg-success-soft text-[oklch(0.42_0.10_195)] border-transparent",
  },
  expired: {
    label: "Expired",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground border-transparent",
  },
  pending_payment: {
    label: "Pending review",
    className: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  },
  none: {
    label: "No plan",
    className: "bg-muted text-muted-foreground border-transparent",
  },
};

function statusFromString(raw: string | null | undefined): SubscriptionStatus {
  switch (raw) {
    case "trial":
    case "trialing":
    case "active":
    case "expired":
    case "cancelled":
    case "pending_payment":
    case "none":
      return raw;
    default:
      return raw ? ("none" as SubscriptionStatus) : ("none" as SubscriptionStatus);
  }
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const m = SUBSCRIPTION_BADGE[statusFromString(status)] ??
    SUBSCRIPTION_BADGE.none;
  return (
    <Badge className={cn("font-medium capitalize", m.className)}>
      {m.label}
    </Badge>
  );
}

function TierBadgeInline({ tier }: { tier: "basic" | "pro" | null }) {
  if (!tier) return null;
  const styles = {
    basic: "bg-muted text-muted-foreground",
    pro: "bg-accent text-accent-foreground",
  } as const;
  return (
    <Badge
      variant="outline"
      className={cn("capitalize font-medium", styles[tier])}
    >
      {tier}
    </Badge>
  );
}

function fmtPrice(pkr: number): string {
  return pkr.toLocaleString("en-PK");
}

function fmtPkrAmount(pkr: number): string {
  return `PKR ${fmtPrice(pkr)}`;
}

function fmtDateIso(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
}

function fmtTimeIso(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Karachi",
  });
}

function daysUntil(targetIso: string): number {
  const ms = new Date(targetIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

const PAYMENT_METHOD_LABEL: Record<
  "jazzcash" | "easypaisa" | "bank_transfer",
  string
> = {
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  bank_transfer: "Bank Transfer",
};

// Two-card upgrade options. Each card lists its own feature set inline so the
// owner sees exactly what they'd get before clicking through to the payment
// page. Features mirror the `plans.features` jsonb shape on the backend; the
// `enabled` flag here is what THAT tier unlocks (not a comparison to current
// plan) — easier to reason about and matches how the pricing CTA on the
// landing page describes the tier.
type UpgradeCard = {
  planId: "basic" | "pro";
  name: string;
  price: number;
  tagline: string;
  cta: string;
  recommended?: boolean;
  features: Array<{
    label: string;
    included: boolean;
    key: "whatsapp_ai" | "voice_notes" | "escalations" | "multi_staff" | "analytics";
  }>;
};

const UPGRADE_CARDS: UpgradeCard[] = [
  {
    planId: "basic",
    name: "Basic",
    price: 3000,
    tagline: "Solo stylists just getting started",
    cta: "Get Basic",
    features: [
      { label: "WhatsApp AI receptionist", included: true, key: "whatsapp_ai" },
      { label: "Customer escalations", included: true, key: "escalations" },
      { label: "Voice-note transcription", included: false, key: "voice_notes" },
      { label: "Multi-staff routing", included: false, key: "multi_staff" },
      { label: "Analytics dashboard", included: false, key: "analytics" },
    ],
  },
  {
    planId: "pro",
    name: "Pro",
    price: 6000,
    tagline: "Growing salons with multiple staff",
    cta: "Get Pro",
    recommended: true,
    features: [
      { label: "WhatsApp AI receptionist", included: true, key: "whatsapp_ai" },
      { label: "Customer escalations", included: true, key: "escalations" },
      { label: "Voice-note transcription", included: true, key: "voice_notes" },
      { label: "Multi-staff routing", included: true, key: "multi_staff" },
      { label: "Analytics dashboard", included: true, key: "analytics" },
    ],
  },
];

/**
 * Derive the display title and behavior from raw subscription state.
 * Right now the businesses row carries `plan_id='basic'` even for salons
 * that are still on the FREE trial — that's a legacy default from signup.
 * So a salon that is `subscription_status='trial'` should NOT be labeled
 * "Basic · PKR 3,000/month"; it's free until a payment is approved.
 */
type DisplayState = {
  title: string;
  subtitle: string | null;
  showUpgradeCards: boolean;
  currentPlanId: "basic" | "pro" | null;
  statusBadge: SubscriptionStatus;
};

function deriveDisplayState(data: {
  subscription_status: string;
  tier: "basic" | "pro" | null;
  plan: { monthly_price_pkr: number; description: string | null } | null;
  trial_status: string;
  days_remaining: number | null;
  is_expired: boolean;
  trial_ends_at: string | null;
}): DisplayState {
  const isTrialFlag =
    data.subscription_status === "trial" ||
    data.subscription_status === "trialing";
  const isActive = data.subscription_status === "active";
  const isPending =
    data.subscription_status === "pending_payment" ||
    data.subscription_status === "pending";
  const isPaidActive = isActive && data.tier !== null;

  // ─────────────────────────────────────────────────────────────────────
  // The trial cron flips `trial_status='expired'` ONCE per hour, but the
  // bot's `message-handler.ts` checks `trial_ends_at < now()` directly on
  // every inbound message — so customers start seeing the fallback reply
  // the moment the timestamp passes, even before the cron fires. The
  // subscription tab must use the same authoritative source (`is_expired`
  // + `trial_ends_at`) so the owner-facing view never disagrees with
  // what their customers actually experience.
  //
  // `is_expired` is computed server-side by `lib/trial.ts:48` from a
  // clock check against `trial_ends_at`, so it's the safest single
  // source of truth. Treat `trial_status === 'expired'` as definitive
  // too — the cron may have just flipped it.
  // ─────────────────────────────────────────────────────────────────────
  const trialExplicitlyExpired =
    data.trial_status === "expired" || data.is_expired === true;
  const trialTimePassed =
    data.trial_ends_at != null &&
    new Date(data.trial_ends_at).getTime() < Date.now();

  const trialHasExpired =
    isTrialFlag && (trialExplicitlyExpired || trialTimePassed);

  if (isPending) {
    return {
      title: "Payment under review",
      subtitle:
        "We've received your payment request. Activation is usually within a few hours — we'll email you the moment your plan is live.",
      showUpgradeCards: false,
      currentPlanId: data.tier,
      statusBadge: "pending_payment",
    };
  }
  if (trialHasExpired) {
    return {
      title: "Trial ended",
      subtitle: data.trial_ends_at
        ? `Your free trial ended on ${formatEndsOn(data.trial_ends_at)}. Pick a plan below to reactivate Recepta.`
        : "Your free trial ended. Pick a plan below to reactivate Recepta.",
      showUpgradeCards: true,
      currentPlanId: null,
      statusBadge: "expired",
    };
  }
  if (isTrialFlag) {
    return {
      title: "Free trial",
      subtitle:
        data.days_remaining != null && data.days_remaining > 0
          ? `${data.days_remaining} day${data.days_remaining === 1 ? "" : "s"} remaining — keep going, or pick a plan below.`
          : "Your trial is active. Pick a plan to keep Recepta running when it ends.",
      showUpgradeCards: true,
      currentPlanId: null,
      statusBadge: "trial",
    };
  }
  if (isPaidActive && data.plan) {
    return {
      title: data.plan.description ?? `${data.tier} plan active`,
      subtitle: null,
      showUpgradeCards: data.tier !== "pro",
      currentPlanId: data.tier,
      statusBadge: "active",
    };
  }
  // Fallback (subscription_status='none' or unknown)
  return {
    title: "No plan yet",
    subtitle:
      "Recepta will keep running through your free trial — pick a plan to keep it active afterwards.",
    showUpgradeCards: true,
    currentPlanId: null,
    statusBadge: "none",
  };
}

// PKT-formatted short date for the "Trial ended on X" subtitle. Same
// TZ choice as the other date helpers so the two views agree.
function formatEndsOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
}

export function TenantSubscription() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";

  const q = useQuery({
    queryKey: businessId ? qk.mySubscription(businessId) : ["subscription", "none"],
    queryFn: () => api.mySubscription(businessId),
    enabled: !!businessId,
    // Always refetch on mount + window-focus so a fresh superadmin approval
    // is visible the moment the salon owner lands back on this tab — without
    // the 60s stale window leaving the previous (pre-approval) data showing.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  if (q.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <HeaderSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subscription</h1>
          <p className="text-sm text-muted-foreground">
            Your current plan, billing cycle, and what's included.
          </p>
        </div>
        <Card className="border shadow-none bg-white">
          <CardContent className="p-6 flex items-start gap-3">
            <ShieldAlert className="size-5 text-destructive mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium">
                Could not load subscription
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {String(
                  (q.error as Error | undefined)?.message ?? "Unknown error",
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => q.refetch()}
              >
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = q.data;
  const display = deriveDisplayState(data);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Subscription</h1>
        <p className="text-sm text-muted-foreground">
          Your current plan, billing cycle, and what's included. Manage by
          paying via JazzCash, Easypaisa, or bank transfer — activation is
          manual and usually takes a few hours.
        </p>
      </div>

      {/* 1. Plan header — shows real subscription state, not legacy plan_id */}
      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            {display.currentPlanId ? (
              <TierBadgeInline tier={display.currentPlanId} />
            ) : null}
            <SubscriptionStatusBadge status={display.statusBadge} />
          </div>
          <CardTitle className="text-2xl flex items-baseline gap-2 mt-3">
            <Sparkles className="size-5 text-primary shrink-0" />
            {display.title}
          </CardTitle>
          {display.subtitle ? (
            <p className="text-sm text-muted-foreground mt-1">
              {display.subtitle}
            </p>
          ) : data.plan ? (
            <div className="text-sm text-muted-foreground mt-1">
              {fmtPkrAmount(data.plan.monthly_price_pkr)}{" "}
              <span className="text-xs">/ month</span>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="pt-0">
          {data.plan?.description ? (
            <p className="text-sm text-muted-foreground">
              {data.plan.description}
            </p>
          ) : data.plan == null ? (
            <div className="rounded-2xl border border-dashed border-border bg-background/50 p-4">
              <p className="text-sm text-muted-foreground">
                You're on a free trial. Upgrade to keep your AI receptionist
                running after the trial ends.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 2. Billing card */}
      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" />
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <BillingCell
            label="Next billing date"
            value={
              data.next_billing_date
                ? fmtDateIso(data.next_billing_date)
                : "—"
            }
            sub={
              data.subscription_status === "active" && data.next_billing_date
                ? `in ${daysUntil(data.next_billing_date)} day${daysUntil(data.next_billing_date) === 1 ? "" : "s"}`
                : display.statusBadge === "expired"
                  ? "Trial ended"
                  : display.statusBadge === "trial" && data.days_remaining != null
                    ? `Trial ends in ${data.days_remaining} day${data.days_remaining === 1 ? "" : "s"}`
                    : undefined
            }
          />
          <BillingCell
            label="Payment method"
            value={
              data.payment_method
                ? PAYMENT_METHOD_LABEL[data.payment_method]
                : "—"
            }
            sub={
              data.last_payment
                ? `Last paid via ${PAYMENT_METHOD_LABEL[data.last_payment.payment_method]}`
                : undefined
            }
          />
          <BillingCell
            label="Last payment"
            value={
              data.last_payment
                ? fmtPkrAmount(data.last_payment.amount_pkr)
                : "No payments yet"
            }
            sub={
              data.last_payment
                ? `${fmtTimeIso(data.last_payment.reviewed_at)}${data.last_payment.transaction_reference ? ` · ${data.last_payment.transaction_reference}` : ""}`
                : undefined
            }
          />
        </CardContent>
      </Card>

      {/* 3. Upgrade options — two-card grid shown when not on active Pro */}
      {display.showUpgradeCards ? (
        <Card className="border shadow-none bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="size-4 text-muted-foreground" />
              {display.currentPlanId
                ? "Upgrade your plan"
                : "Choose your plan"}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Pick a tier, pay via JazzCash / Easypaisa / bank transfer, and
              we'll activate your subscription within 24 hours.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {UPGRADE_CARDS.map((card) => {
                const isCurrent = display.currentPlanId === card.planId;
                return (
                  <div
                    key={card.planId}
                    className={cn(
                      "rounded-2xl border p-5 flex flex-col gap-4 transition",
                      card.recommended
                        ? "border-accent bg-gradient-to-b from-accent/10 to-transparent shadow-luxe"
                        : "border-border bg-card",
                      isCurrent && "ring-2 ring-accent/60",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display text-lg font-semibold tracking-tight">
                            {card.name}
                          </span>
                          {card.recommended ? (
                            <Badge className="bg-accent text-accent-foreground text-[10px] uppercase tracking-widest">
                              Recommended
                            </Badge>
                          ) : null}
                          {isCurrent ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-widest border-accent text-accent-foreground"
                            >
                              Current
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {card.tagline}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-display text-2xl font-semibold tabular-nums">
                          PKR {fmtPrice(card.price)}
                        </div>
                        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                          per month
                        </div>
                      </div>
                    </div>

                    <ul className="space-y-2 text-sm">
                      {card.features.map((f) => (
                        <li
                          key={f.key}
                          className="flex items-start gap-2"
                        >
                          {f.included ? (
                            <Check className="size-4 text-[oklch(0.42_0.10_195)] mt-0.5 shrink-0" />
                          ) : (
                            <X className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                          )}
                          <span
                            className={cn(
                              f.included
                                ? "text-foreground"
                                : "text-muted-foreground line-through",
                            )}
                          >
                            {f.label}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      asChild={!isCurrent}
                      variant={card.recommended ? "default" : "outline"}
                      className="w-full mt-auto"
                      disabled={isCurrent}
                      title={isCurrent ? "You're already on this plan" : undefined}
                    >
                      {isCurrent ? (
                        <span>Current plan</span>
                      ) : (
                        <Link
                          to="/payment"
                          search={{ plan: card.planId }}
                        >
                          <CreditCard className="size-4" />
                          {card.cta}
                        </Link>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* 4. What's included — features grid reflecting CURRENT plan */}
      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            What's included on{" "}
            {display.currentPlanId
              ? display.currentPlanId === "pro"
                ? "Pro"
                : "Basic"
              : "your plan"}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Features below show what's enabled on your current plan. Locked
            items become available when you upgrade.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 md:grid-cols-2">
            {KNOWN_FEATURES.map((f) => {
              const enabled = !!data.plan?.features?.[f.key];
              return (
                <li
                  key={f.key}
                  className={cn(
                    "rounded-2xl border p-4 flex items-start gap-3",
                    enabled
                      ? "border-success-soft bg-success-soft/40"
                      : "border-dashed bg-muted/30",
                  )}
                >
                  <div
                    className={cn(
                      "size-9 rounded-md grid place-items-center shrink-0",
                      enabled
                        ? "bg-success-soft text-[oklch(0.42_0.10_195)]"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <f.icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          !enabled && "line-through text-muted-foreground",
                        )}
                      >
                        {f.label}
                      </span>
                      {enabled ? (
                        <Check className="size-4 text-[oklch(0.42_0.10_195)]" />
                      ) : (
                        <X className="size-4 text-muted-foreground" />
                      )}
                      {f.proOnly && !enabled ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-widest border-accent text-accent-foreground"
                        >
                          Pro
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {f.description}
                    </div>
                    {!enabled && (
                      <div className="text-[11px] text-muted-foreground mt-1 italic">
                        Upgrade to enable
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Helpful fine-print */}
      <p className="text-xs text-muted-foreground text-center">
        Need to cancel or change billing? Email{" "}
        <a
          href="mailto:hello@recepta.pk"
          className="underline underline-offset-2 hover:text-foreground"
        >
          hello@recepta.pk
        </a>{" "}
        — we handle cancellations manually.
      </p>
    </div>
  );
}

function BillingCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
      {sub ? (
        <div className="text-xs text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-80" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <Card className="border shadow-none bg-white">
      <CardContent className="p-6 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
