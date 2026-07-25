import { createFileRoute } from "@tanstack/react-router";
import { TenantInbox } from "@/components/tenant/TenantInbox";

export const Route = createFileRoute("/salon-portal/inbox")({
  head: () => ({
    meta: [
      { title: "Conversations & Inbox — Salon Admin Portal" },
      { name: "description", content: "Live WhatsApp customer conversations with human takeover." },
    ],
  }),
  component: TenantInbox,
});
