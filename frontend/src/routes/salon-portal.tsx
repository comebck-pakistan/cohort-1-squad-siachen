import { createFileRoute } from "@tanstack/react-router";
import { TenantShell } from "@/components/tenant/TenantShell";

export const Route = createFileRoute("/salon-portal")({
  head: () => ({
    meta: [
      { title: "Salon Admin Portal — Recepta" },
      { name: "description", content: "Tenant portal for salon owners to manage AI agent, bookings, and staff." },
      { property: "og:title", content: "Salon Admin Portal — Recepta" },
      { property: "og:description", content: "Manage AI agent, WhatsApp inbox, and business rules." },
    ],
  }),
  component: TenantShell,
});
