import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquare,
  DollarSign,
  AlertTriangle,
  Building2,
  CalendarClock,
  CreditCard,
  Bot,
  Cog,
} from "lucide-react";
import type { AuditEvent } from "@/types";

const kindIcon: Record<AuditEvent["kind"], typeof MessageSquare> = {
  message: Bot,
  booking: CalendarClock,
  billing: CreditCard,
  system: Cog,
};

function formatPKR(n: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(n);
}

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function OverviewTab() {
  const kpis = useQuery({ queryKey: qk.kpis, queryFn: api.kpis });
  const audit = useQuery({ queryKey: qk.audit, queryFn: api.auditStream });

  const stats = [
    {
      label: "Messages Delivered",
      value: kpis.data ? kpis.data.messagesDelivered.toLocaleString() : null,
      icon: MessageSquare,
      hint: "Last 30 days",
    },
    {
      label: "Revenue",
      value: kpis.data ? formatPKR(kpis.data.revenuePKR) : null,
      icon: DollarSign,
      hint: "Monthly recurring",
    },
    {
      label: "Pending Cases",
      value: kpis.data ? String(kpis.data.pendingCases) : null,
      icon: AlertTriangle,
      hint: "Requires human review",
    },
    {
      label: "Active Salons",
      value: kpis.data ? String(kpis.data.activeSalons) : null,
      icon: Building2,
      hint: "Currently billing",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="border shadow-none">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </div>
                  {s.value ? (
                    <div className="text-2xl font-semibold tracking-tight">{s.value}</div>
                  ) : (
                    <Skeleton className="h-7 w-24" />
                  )}
                  <div className="text-xs text-muted-foreground">{s.hint}</div>
                </div>
                <div className="size-9 rounded-md bg-primary/10 text-primary grid place-items-center">
                  <s.icon className="size-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Audit Stream</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {audit.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full animate-pulse" />
              ))}
            </div>
          ) : (
            <ul className="divide-y">
              {audit.data?.map((e) => {
                const Icon = kindIcon[e.kind];
                return (
                  <li key={e.id} className="flex items-start gap-3 px-6 py-4">
                    <div className="size-8 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground">{e.summary}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {e.business_name}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">
                      {timeAgo(e.created_at)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}