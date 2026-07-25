import { createFileRoute } from "@tanstack/react-router";
import { SubsTab } from "@/components/dashboard/SubsTab";

export const Route = createFileRoute("/superadmin/subscriptions")({
  head: () => ({
    meta: [
      { title: "Subscriptions — Recepta Admin" },
      { name: "description", content: "Revenue analytics and payment logs across all tiers." },
      { property: "og:title", content: "Subscriptions — Recepta Admin" },
      { property: "og:description", content: "Revenue analytics across tiers." },
    ],
  }),
  component: SubsTab,
});
