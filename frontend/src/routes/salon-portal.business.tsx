import { createFileRoute } from "@tanstack/react-router";
import { TenantBusiness } from "@/components/tenant/TenantBusiness";

export const Route = createFileRoute("/salon-portal/business")({
  head: () => ({
    meta: [
      { title: "Business Settings — Salon Admin Portal" },
      { name: "description", content: "Operating hours, services catalog, and staff allocation." },
    ],
  }),
  component: TenantBusiness,
});
