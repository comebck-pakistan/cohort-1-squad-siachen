import { createFileRoute } from "@tanstack/react-router";
import { TenantEscalations } from "@/components/tenant/TenantEscalations";

export const Route = createFileRoute("/salon-portal/escalations")({
  head: () => ({
    meta: [
      { title: "Escalations — Salon Admin Portal" },
      { name: "description", content: "Flagged customer chats requiring human intervention." },
    ],
  }),
  component: TenantEscalations,
});
