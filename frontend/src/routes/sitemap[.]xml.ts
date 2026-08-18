import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// /sitemap.xml — Wave 17 expansion.
//
// Lists every public-marketing route that should be indexed. Private
// surfaces (owner portal, superadmin, payment-success) are explicitly
// excluded — see robots.txt for the same set.
//
// Update this list when adding a new public route (privacy/terms/waitlist
// were added in this wave).
// ---------------------------------------------------------------------------

const PUBLIC_ROUTES: Array<{
  path: string;
  changefreq: "weekly" | "monthly" | "yearly";
  priority: string;
}> = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/payment", changefreq: "monthly", priority: "0.7" },
  { path: "/waitlist", changefreq: "monthly", priority: "0.7" },
  { path: "/onboarding", changefreq: "monthly", priority: "0.8" },
  { path: "/login", changefreq: "monthly", priority: "0.4" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const origin = "https://receptaagent.tech";
        const urls = PUBLIC_ROUTES.map(
          (e) =>
            `  <url>\n    <loc>${origin}${e.path}</loc>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`,
        ).join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
