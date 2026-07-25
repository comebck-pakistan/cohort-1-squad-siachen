import { createFileRoute } from "@tanstack/react-router";
import { SalonsTab } from "@/components/dashboard/SalonsTab";

export const Route = createFileRoute("/superadmin/salons")({
  head: () => ({
    meta: [
      { title: "Salons — Recepta Admin" },
      { name: "description", content: "Directory of salon tenants with tier, city, and billing filters." },
      { property: "og:title", content: "Salons — Recepta Admin" },
      { property: "og:description", content: "Directory of salon tenants." },
    ],
  }),
  component: SalonsTab,
});
