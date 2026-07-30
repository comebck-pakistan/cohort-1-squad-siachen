import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  UserCog,
  ArrowRight,
  CheckCircle2,
  Phone,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, qk } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";

// ---------------------------------------------------------------------------
// /salon-portal/escalations — Edge Cases tab
//
// Escalations come from GET /api/business/:id/escalations (real Supabase
// data joined with conversations + customers + edge_case_rules). Until
// the AI agent has flagged something, the list is genuinely empty — we
// render a friendly "all clear" state instead of fake Hassan/Rida entries.
// ---------------------------------------------------------------------------

type Severity = "high" | "medium" | "low";

const sevStyle: Record<Severity, string> = {
  high: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
  medium: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  low: "bg-muted text-muted-foreground border-transparent",
};

function severityFromRuleKind(kind: string | undefined): Severity {
  if (kind === "hard") return "high";
  if (kind === "soft") return "medium";
  return "low";
}

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function TenantEscalations() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";

  const q = useQuery({
    queryKey: businessId
      ? qk.escalations(businessId)
      : ["escalations", "none"],
    queryFn: () => api.escalations(businessId),
    enabled: !!businessId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const allRows = q.data?.escalations ?? [];
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const items = allRows.filter((e) => !resolvedIds.includes(e.id) && !e.resolved);

  function resolve(id: string) {
    setResolvedIds((s) => [...s, id]);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Escalations & Edge Cases</h1>
        <p className="text-sm text-muted-foreground">
          Chats the AI flagged for human review. Handle these first.
        </p>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="border shadow-none bg-white">
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="border shadow-none bg-white">
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="size-8 text-primary mx-auto" />
            <div className="mt-3 text-sm font-medium">All clear</div>
            <div className="text-xs text-muted-foreground">
              {allRows.length === 0
                ? "No escalations yet. When the AI flags something for human review, it shows up here."
                : "You've resolved every escalation. New ones will appear here as customers message."}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((e) => {
            const severity = severityFromRuleKind(e.rule_kind);
            return (
              <Card key={e.id} className="border shadow-none bg-white">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="size-9 rounded-md bg-danger-soft text-[oklch(0.4_0.18_27)] grid place-items-center shrink-0">
                        <AlertTriangle className="size-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">
                          {e.customer_name || "Unknown"}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                          <Phone className="size-3" /> {e.customer_phone || "—"}
                        </div>
                      </div>
                    </div>
                    <Badge className={cn("text-[10px]", sevStyle[severity])}>
                      {severity.toUpperCase()}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-sm font-medium">{e.rule_label || e.reason}</div>
                    {e.ai_draft && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        AI draft: {e.ai_draft}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" /> {fmtAge(e.created_at)}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline">
                        <UserCog className="size-4" /> Take Over
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => resolve(e.id)}
                        className="bg-primary hover:bg-primary/90"
                      >
                        Resolve <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {q.isError && (
        <Card className="border shadow-none bg-white">
          <CardContent className="p-6 flex items-start gap-3">
            <ShieldAlert className="size-5 text-destructive mt-0.5" />
            <div>
              <div className="text-sm font-medium">Could not load escalations</div>
              <div className="text-xs text-muted-foreground mt-1">
                {String((q.error as Error)?.message || "Unknown error")}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
