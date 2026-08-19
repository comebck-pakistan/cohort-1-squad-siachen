import { createFileRoute } from "@tanstack/react-router";
import { MaintenanceTab } from "@/components/dashboard/MaintenanceTab";

export const Route = createFileRoute("/superadmin/maintenance")({
  head: () => ({
    meta: [{ title: "Maintenance · Recepta superadmin" }],
  }),
  component: MaintenanceTab,
});
