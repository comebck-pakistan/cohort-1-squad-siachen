// ---------------------------------------------------------------------------
// MaintenanceBadge.tsx — header badge visible across ALL superadmin routes
// when maintenance is ON. Polls the state endpoint every 30s.
//
// Returns null when maintenance is off. Renders the inferred chip when
// the resolver fell back to fail-closed.
// ---------------------------------------------------------------------------

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Wrench } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";

import { api, qk } from "@/lib/api";
import { formatRemainingTime } from "@/lib/maintenance-helpers";

export function MaintenanceBadge() {
  const stateQ = useQuery({
    queryKey: qk.maintenanceState,
    queryFn: () => api.getMaintenanceState(),
    refetchInterval: 30_000,
  });
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (stateQ.isError || !stateQ.data) return null;
  const state = stateQ.data.state;
  if (!state.enabled) return null;

  const remaining = formatRemainingTime(state.endsAt);
  const onMaintenanceTab = pathname === "/superadmin/maintenance";

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/superadmin/maintenance" })}
      className="inline-flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-ring rounded-md"
      aria-label="Maintenance is on. Open maintenance tab."
      title={
        onMaintenanceTab
          ? "Maintenance is on"
          : "Maintenance is on. Click to open the Maintenance tab."
      }
    >
      <Badge className="bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent gap-1">
        <span className="pulse-dot text-current" />
        <Wrench className="size-3" />
        Maintenance On
      </Badge>
      <Badge variant="outline" className="text-muted-foreground tabular-nums">
        {state.scope} · {remaining}
      </Badge>
      {state.inferred && (
        <Badge
          variant="outline"
          className="text-warning-foreground border-warning/40 gap-1"
          title="Resolver fell back to fail-closed (DB unreachable)"
        >
          <ShieldAlert className="size-3" />
          Inferred
        </Badge>
      )}
    </button>
  );
}
