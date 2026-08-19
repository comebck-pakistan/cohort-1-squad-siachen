// ---------------------------------------------------------------------------
// NotificationsBellBadge.tsx — superadmin-only. Shows whether an active
// notification exists and links to the Notifications tab. Renders null
// when there's no active notification.
//
// Polls /api/notifications/active every 60s.
// ---------------------------------------------------------------------------

import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { api, qk } from "@/lib/api";

export function NotificationsBellBadge() {
  const q = useQuery({
    queryKey: qk.notificationsActive,
    queryFn: () => api.getActiveNotification(),
    refetchInterval: 60_000,
  });
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (q.isError || !q.data?.notification) return null;
  const n = q.data.notification;
  const onTab = pathname === "/superadmin/notifications";

  const tone =
    n.severity === "critical"
      ? "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent"
      : n.severity === "warning"
        ? "bg-warning-soft text-[oklch(0.4_0.12_85)] border-transparent"
        : "bg-info-soft text-[oklch(0.42_0.10_195)] border-transparent";

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/superadmin/notifications" })}
      className="inline-flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-ring rounded-md"
      aria-label={`${n.severity} notification active. Open Notifications tab.`}
      title={
        onTab
          ? "Notification active"
          : "Notification active. Click to open the Notifications tab."
      }
    >
      <Badge className={`${tone} gap-1`}>
        <Megaphone className="size-3" />
        {n.severity === "critical"
          ? "Critical"
          : n.severity === "warning"
            ? "Warning"
            : "Info"}
      </Badge>
    </button>
  );
}
