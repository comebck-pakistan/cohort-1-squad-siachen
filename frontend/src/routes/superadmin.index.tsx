import { createFileRoute } from "@tanstack/react-router";
import { OverviewTab } from "@/components/dashboard/OverviewTab";

export const Route = createFileRoute("/superadmin/")({
  head: () => ({
    meta: [
      { title: "Overview — Recepta Admin" },
      { name: "description", content: "Global KPIs, revenue and recent audit stream across all salon tenants." },
      { property: "og:title", content: "Admin Overview — Recepta" },
      { property: "og:description", content: "Global KPIs across salon tenants." },
    ],
  }),
  component: OverviewTab,
});
