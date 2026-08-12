import { AlertOctagon, Clock, Sparkles, CheckCheck, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SubscriptionPanel — Wave 7 (revised).
//
// Replaces the full-width UpgradeBanner that was previously rendered at the
// top of the salon portal. The owner sees the salon's billing state in the
// sidebar where it lives alongside the other dashboard chrome — never
// covering half the screen.
//
// States:
//   converted     → green pill: "Paid subscription"
//   active        → trial meter with days remaining + end date
//   expiring_soon → amber: "Trial ends in X days" + warning chip
//   expired       → red: "Trial ended" + upgrade CTA
//   null/missing  → render nothing (pre-Wave-7 salons are grandfathered;
//                    they have no trial clock and shouldn't see a panel that
//                    suggests otherwise).
// ---------------------------------------------------------------------------

export interface SubscriptionPanelData {
  trial_status: "active" | "expiring_soon" | "expired" | "converted";
  /** ISO timestamp. NULL = pre-Wave-7 row (grandfathered, no trial). */
  trial_ends_at: string | null;
  days_remaining: number | null;
  is_expired: boolean;
}

// Format an ISO date as "12 Aug" (PKT-style short). Defensive null guard.
function formatEndsOn(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Karachi",
  });
}

function progressPct(daysRemaining: number | null): number {
  // 7-day trial is the design contract. If days_remaining is missing,
  // assume just-started (≈full bar).
  if (daysRemaining == null) return 100;
  const total = 7;
  const used = Math.max(0, total - daysRemaining);
  return Math.min(100, Math.max(0, (used / total) * 100));
}

export function SubscriptionPanel({
  data,
  isLoading,
}: {
  data: SubscriptionPanelData | undefined;
  isLoading: boolean;
}) {
  // Pre-Wave-7 rows: trial_status is null/undefined -> no trial, no panel.
  if (!data) return null;

  const { trial_status, trial_ends_at, days_remaining, is_expired } = data;

  // Grandfathered row — has trial_status='active' but null endsAt (no clock).
  // The backend still calls this "active" so the bot enforcement stays quiet,
  // but visually we want to show "Paid subscription" since these are paid
  // Wave-6-or-earlier salons that never had a trial.
  if (!trial_ends_at) {
    return (
      <div className="mx-3 mb-3 rounded-lg border border-success-soft/60 bg-success-soft/30 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-[oklch(0.42_0.10_195)]">
          <CheckCheck className="size-3.5" />
          Active subscription
        </div>
        <div className="mt-0.5 text-muted-foreground">
          AI receptionist is active.
        </div>
      </div>
    );
  }

  // 1. Converted (paid) — neutral positive state.
  if (trial_status === "converted") {
    return (
      <div className="mx-3 mb-3 rounded-lg border border-success-soft/60 bg-success-soft/30 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-[oklch(0.42_0.10_195)]">
          <CheckCheck className="size-3.5" />
          Paid subscription
        </div>
        <div className="mt-0.5 text-muted-foreground">
          AI receptionist is active.
        </div>
      </div>
    );
  }

  // 2. Expired — the only panel that needs a CTA. Sits below the nav so
  // the owner sees it every time she opens the dashboard.
  if (is_expired || trial_status === "expired") {
    return (
      <div className="mx-3 mb-3 rounded-lg border border-danger-soft/60 bg-danger-soft/30 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-[oklch(0.4_0.18_27)]">
          <AlertOctagon className="size-3.5" />
          Trial ended
        </div>
        <div className="mt-0.5 text-muted-foreground">
          Customers are receiving a fallback reply.
        </div>
        <Button
          asChild
          size="sm"
          className="mt-2 w-full rounded-md"
          variant="default"
        >
          <a href="mailto:hello@recepta.pk?subject=Trial%20upgrade%20request">
            Upgrade
            <ArrowUpRight className="size-3.5" />
          </a>
        </Button>
      </div>
    );
  }

  // 3. Expiring soon — amber, no CTA yet (we already sent the WhatsApp
  // warning to the owner from the cron job).
  if (trial_status === "expiring_soon") {
    const endsOn = formatEndsOn(trial_ends_at);
    return (
      <div className="mx-3 mb-3 rounded-lg border border-warning-soft/60 bg-warning-soft/30 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-[oklch(0.45_0.14_70)]">
          <Clock className="size-3.5" />
          Trial ends {days_remaining != null ? `in ${days_remaining} day${days_remaining === 1 ? "" : "s"}` : "soon"}
        </div>
        {endsOn && (
          <div className="mt-0.5 text-muted-foreground">
            Ends {endsOn}
          </div>
        )}
      </div>
    );
  }

  // 4. Active — trial meter. This is the most common state, so keep it
  // visually quiet.
  const endsOn = formatEndsOn(trial_ends_at);
  const pct = progressPct(days_remaining);
  return (
    <div className="mx-3 mb-3 rounded-lg border bg-primary-soft/30 p-3 text-xs">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Sparkles className="size-3.5 text-primary" />
        Free trial
      </div>
      <div className="mt-0.5 text-muted-foreground">
        {days_remaining != null
          ? `${days_remaining} day${days_remaining === 1 ? "" : "s"} remaining`
          : "Active"}
        {endsOn ? ` · ends ${endsOn}` : ""}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full bg-primary transition-all")}
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
