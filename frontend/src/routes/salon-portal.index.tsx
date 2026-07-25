import { createFileRoute } from "@tanstack/react-router";
import { TenantOverview } from "@/components/tenant/TenantOverview";

export const Route = createFileRoute("/salon-portal/")({
  head: () => ({
    meta: [
      { title: "Overview — Salon Admin Portal" },
      { name: "description", content: "Live stats, upcoming bookings, and AI resolution rate." },
    ],
  }),
  component: TenantOverview,
});
