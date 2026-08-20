// ---------------------------------------------------------------------------
// MaintenanceStateSection.tsx — current effective state, with global
// enable/disable controls. Shows scope, message preview, time remaining,
// and an "inferred" badge when the resolver fell back to fail-closed.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Power, PowerOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { api, qk } from "@/lib/api";
import { formatRemainingTime } from "@/lib/maintenance-helpers";
import type { Business } from "@/types";

import { EnableMaintenanceDialog } from "./EnableMaintenanceDialog";

interface Props {
  salons: Business[];
}

export function MaintenanceStateSection({ salons }: Props) {
  const qc = useQueryClient();
  const [enableOpen, setEnableOpen] = useState(false);

  const stateQ = useQuery({
    queryKey: qk.maintenanceState,
    queryFn: () => api.getMaintenanceState(),
    refetchInterval: 30_000,
  });

  const disableMut = useMutation({
    mutationFn: () => api.disableGlobalMaintenance(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      toast.success("Global maintenance disabled");
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  if (stateQ.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Current state</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (stateQ.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Current state</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Could not load maintenance state: {(stateQ.error as Error).message}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!stateQ.data) return null;
  const state = stateQ.data.state;
  const isOn = state.enabled;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Current state</CardTitle>
            <p className="text-xs text-muted-foreground">
              {isOn
                ? "Maintenance is active. Customer messages get the fixed reply."
                : "Maintenance is off. Customer messages go to the LLM."}
            </p>
          </div>
          {isOn ? (
            <Badge className="bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent gap-1">
              <span className="pulse-dot text-current" />
              Maintenance On
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Off
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isOn && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="capitalize">
                  {state.scope}
                </Badge>
                {state.inferred && (
                  <Badge variant="outline" className="text-warning-foreground border-warning/40 gap-1">
                    <ShieldAlert className="size-3" />
                    Inferred (DB unreachable)
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  · {formatRemainingTime(state.endsAt)}
                </span>
              </div>
              <p className="text-sm leading-relaxed">{state.message}</p>
              <p className="text-xs text-muted-foreground">
                Cooldown: {state.cooldownMinutes} min per customer
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {isOn ? (
              <Button
                variant="destructive"
                onClick={() => disableMut.mutate()}
                disabled={disableMut.isPending}
              >
                {disableMut.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                <PowerOff className="size-4" />
                Disable global maintenance
              </Button>
            ) : (
              <Button onClick={() => setEnableOpen(true)}>
                <Power className="size-4" />
                Enable global maintenance
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <EnableMaintenanceDialog
        open={enableOpen}
        onOpenChange={setEnableOpen}
        mode="global"
        salons={salons}
      />
    </>
  );
}
