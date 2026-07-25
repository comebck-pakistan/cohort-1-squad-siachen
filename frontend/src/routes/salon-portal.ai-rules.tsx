import { createFileRoute } from "@tanstack/react-router";
import { TenantAIRules } from "@/components/tenant/TenantAIRules";

export const Route = createFileRoute("/salon-portal/ai-rules")({
  head: () => ({
    meta: [
      { title: "AI Agent Rules — Salon Admin Portal" },
      { name: "description", content: "Custom rules, edge cases, escalation triggers and test sandbox." },
    ],
  }),
  component: TenantAIRules,
});
