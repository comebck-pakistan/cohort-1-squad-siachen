import { createFileRoute } from "@tanstack/react-router";
import { SettingsTab } from "@/components/dashboard/SettingsTab";

export const Route = createFileRoute("/superadmin/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Recepta Admin" },
      { name: "description", content: "Tier limits configuration and AI platform safety rules." },
      { property: "og:title", content: "Settings — Recepta Admin" },
      { property: "og:description", content: "Tier limits and AI safety rules." },
    ],
  }),
  component: SettingsTab,
});
