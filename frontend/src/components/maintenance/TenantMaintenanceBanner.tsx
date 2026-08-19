// ---------------------------------------------------------------------------
// TenantMaintenanceBanner.tsx — shows a STATIC banner (no marquee) at the
// top of the salon-portal dashboard when maintenance mode is on for the
// tenant's business (global OR salon-scoped).
//
// Renders nothing when maintenance is off. Different visual style from
// the GlobalNotificationBanner so the two are not confused:
//   - Warning color (amber) — matches the "something is paused" UX
//   - Wrench icon (the same one superadmin sees in the header)
//   - Static text (no animation), no X (per-page render — no persistence)
//
// Polls every 30s. Same cache TTL as the rest of the maintenance system.
// ---------------------------------------------------------------------------

import { useQuery } from "@tanstack/react-query";
import { Wrench } from "lucide-react";

import { api, qk } from "@/lib/api";

export function TenantMaintenanceBanner() {
  const stateQ = useQuery({
    queryKey: qk.maintenanceEffective,
    queryFn: () => api.getEffectiveMaintenanceState(),
    refetchInterval: 30_000,
  });

  if (stateQ.isError) return null;
  const state = stateQ.data?.state;
  if (!state || !state.enabled) return null;

  // Differentiate scope in the message so the tenant knows whether it's
  // just them or everyone.
  const scopeLabel =
    state.scope === "global" ? "All salons" : "This salon";

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full border-b border-warning/40 bg-warning-soft text-[oklch(0.4_0.12_85)]"
    >
      <div className="flex items-center gap-3 px-4 py-2 text-xs sm:text-sm">
        <span
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-warning text-warning-foreground"
          aria-hidden="true"
        >
          <Wrench className="size-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">Bot is in maintenance mode</p>
          <p className="text-[11px] sm:text-xs opacity-90 line-clamp-2">
            <span className="font-medium">{scopeLabel}</span>{" "}
            {state.message}
          </p>
        </div>
        <span
          className="hidden sm:inline shrink-0 rounded-sm bg-background/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-foreground/70"
          aria-hidden="true"
        >
          {state.scope}
        </span>
      </div>
    </div>
  );
}
