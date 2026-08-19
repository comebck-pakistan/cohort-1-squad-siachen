// ---------------------------------------------------------------------------
// MaintenanceTab.tsx — top-level tab for /superadmin/maintenance.
//
// Three sub-tabs: State / Windows / Audit. The state and audit tabs poll
// the backend every 30s. Salon list is fetched once via api.listSalons() —
// same as SalonsTab — for the per-salon enable dialog.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { api, qk } from "@/lib/api";

import { MaintenanceStateSection } from "@/components/maintenance/MaintenanceStateSection";
import { MaintenanceWindowsSection } from "@/components/maintenance/MaintenanceWindowsSection";
import { MaintenanceAuditSection } from "@/components/maintenance/MaintenanceAuditSection";

type SubTab = "state" | "windows" | "audit";

const SUB_TABS: Array<{ key: SubTab; label: string }> = [
  { key: "state", label: "State" },
  { key: "windows", label: "Windows" },
  { key: "audit", label: "Audit" },
];

export function MaintenanceTab() {
  const [subTab, setSubTab] = useState<SubTab>("state");

  const salonsQ = useQuery({
    queryKey: qk.salons,
    queryFn: () => api.listSalons(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Maintenance
        </h1>
        <p className="text-sm text-muted-foreground">
          System mode controls — pause customer-facing AI for everyone or a
          single salon.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-border/60">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSubTab(t.key)}
            className={
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
              (subTab === t.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {salonsQ.isLoading ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : salonsQ.isError ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-destructive">
              Could not load salons: {(salonsQ.error as Error).message}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {subTab === "state" && (
            <MaintenanceStateSection salons={salonsQ.data ?? []} />
          )}
          {subTab === "windows" && (
            <MaintenanceWindowsSection salons={salonsQ.data ?? []} />
          )}
          {subTab === "audit" && <MaintenanceAuditSection />}
        </>
      )}
    </div>
  );
}
