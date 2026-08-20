import { createFileRoute } from "@tanstack/react-router";
import { NotificationsTab } from "@/components/dashboard/NotificationsTab";

export const Route = createFileRoute("/superadmin/notifications")({
  head: () => ({
    meta: [{ title: "Notifications · Recepta superadmin" }],
  }),
  component: NotificationsTab,
});
