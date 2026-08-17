import { createFileRoute } from "@tanstack/react-router";
import { TenantSubscription } from "@/components/tenant/TenantSubscription";

export const Route = createFileRoute("/salon-portal/subscription")({
  head: () => ({
    meta: [
      { title: "Subscription — Salon Admin Portal" },
      {
        name: "description",
        content:
          "Your current plan, billing cycle, payment method, and what's included.",
      },
    ],
  }),
  component: TenantSubscription,
});
