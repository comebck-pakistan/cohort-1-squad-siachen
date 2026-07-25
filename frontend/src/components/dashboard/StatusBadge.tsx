import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BillingStatus } from "@/types";

const map: Record<BillingStatus, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-success-soft text-[oklch(0.35_0.12_145)] border-transparent",
  },
  grace_period: {
    label: "Grace period",
    className: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  },
  suspended: {
    label: "Suspended",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
  },
};

export function StatusBadge({ status }: { status: BillingStatus }) {
  const m = map[status];
  return <Badge className={cn("font-medium", m.className)}>{m.label}</Badge>;
}

export function TierBadge({ tier }: { tier: "basic" | "pro" | "business" }) {
  const styles = {
    basic: "bg-muted text-muted-foreground",
    pro: "bg-accent text-accent-foreground",
    business: "bg-primary/10 text-primary border-primary/20",
  } as const;
  return (
    <Badge variant="outline" className={cn("capitalize font-medium", styles[tier])}>
      {tier}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: "paid" | "pending" | "failed" }) {
  const styles = {
    paid: "bg-success-soft text-[oklch(0.35_0.12_145)]",
    pending: "bg-warning-soft text-[oklch(0.35_0.1_70)]",
    failed: "bg-danger-soft text-[oklch(0.4_0.18_27)]",
  } as const;
  return (
    <Badge className={cn("capitalize font-medium border-transparent", styles[status])}>
      {status}
    </Badge>
  );
}