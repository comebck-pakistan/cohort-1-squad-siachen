import {
  ProductModuleShowcase,
  ProductDemoFrame,
  type ProductModule,
} from "./ProductModuleShowcase";
import { ProductDemoSequence } from "./ProductDemoSequence";
import {
  PRODUCT_MODULE_DEMOS,
  PRODUCT_MODULE_PREVIEWS,
  type ProductModuleId,
} from "./ProductModulePreviews";
import { SectionReveal } from "./SectionReveal";

// ---------------------------------------------------------------------------
// ProductTour
//
// The section between the hero (which demonstrates the CORE WORKFLOW —
// one WhatsApp conversation → booking → dashboard update) and Features
// (which is the marketing-card overview). This is the deep product tour.
//
// Concept: the section answers "Here is everything Recepta actually does"
// by walking through the dashboard modules in order, alternating left/right.
// The dashboard UI itself is the animation — each module's preview accepts
// { phase, reduced } and animates real state changes inside the actual
// dashboard (row insertions, badge swaps, toggle flips, modal open/close).
// No chat narration overlay.
//
// Story the section tells:
//   Set it up.       → Services
//   Set it up.       → Operating Hours
//   Set it up.       → Agent Rules
//   Let it work.     → Bookings
//   Stay in control → Escalations
//   Stay in control → Overview
//   Manage          → Staff Allocation
//
// Seven modules total. Order and layout alternate so the page reads as
// a guided tour, not a stacked gallery.
// ---------------------------------------------------------------------------

// Static fallback for the Overview module (it has its own subtle "alive"
// animation but doesn't need a phase machine — KPI ticks and feed stagger
// run on mount only).
const STATIC_MODULE_FRAMES: Partial<Record<ProductModuleId, {
  moduleLabel: string;
  pageTitle: string;
  pageDescription?: string;
}>> = {
  overview: {
    moduleLabel: "Overview",
    pageTitle: "Overview",
    pageDescription: "How your AI agent is performing across WhatsApp today.",
  },
};

// Preview wrapper — given a module id, returns either a
// ProductDemoSequence (interactive, with phase machine) or a plain
// ProductDemoFrame (static, mount-only animations).
function makePreview(id: ProductModuleId) {
  const Component = PRODUCT_MODULE_PREVIEWS[id];
  const demo = PRODUCT_MODULE_DEMOS[id];
  if (demo) {
    return (
      <ProductDemoSequence
        phases={demo.phases}
        moduleLabel={demo.moduleLabel}
        pageTitle={demo.pageTitle}
        pageDescription={demo.pageDescription}
      >
        {({ phase, reduced }) => <Component phase={phase} reduced={reduced} />}
      </ProductDemoSequence>
    );
  }
  // Static fallback — use the static frame map.
  const frame = STATIC_MODULE_FRAMES[id] ?? { moduleLabel: "Recepta", pageTitle: "Dashboard" };
  return (
    <ProductDemoFrame
      moduleLabel={frame.moduleLabel}
      pageTitle={frame.pageTitle}
      pageDescription={frame.pageDescription}
    >
      <Component phase={0} reduced={false} />
    </ProductDemoFrame>
  );
}

const productModules: ProductModule[] = [
  {
    id: "module-overview",
    eyebrow: "Your salon at a glance",
    title: "Overview",
    description:
      "See how your AI receptionist is performing across WhatsApp today. Bookings handled, conversations processed, AI resolution rate, revenue via agent, and the most recent actions — all visible the moment you open the dashboard.",
    bullets: [
      "Four top-line KPIs — bookings, conversations, resolution, revenue",
      "Daily conversation volume + what customers ask most",
      "Recent AI actions feed, auto-refreshing",
    ],
    layout: "text-left",
    preview: makePreview("overview"),
  },
  {
    id: "module-bookings",
    eyebrow: "Every booking, organized",
    title: "Bookings",
    description:
      "See appointments by day, customer, service, staff member, and status. Confirm, complete, or cancel from the same screen — auto-refreshed every minute in Asia/Karachi time.",
    bullets: [
      "Today + any future date via the date picker",
      "Status badges: pending · confirmed · completed · cancelled / no-show",
      "Mark Complete, Confirm, or Cancel inline — no separate tabs",
    ],
    layout: "text-right",
    preview: makePreview("bookings"),
  },
  {
    id: "module-hours",
    eyebrow: "Control your availability",
    title: "Operating Hours",
    description:
      "Set when your salon is open. Configure weekly hours, appointment buffers, and custom holidays or closures — Recepta uses your schedule when checking availability and booking appointments.",
    bullets: [
      "Open / Closed toggle per day, with opening and closing times",
      "Custom holidays — e.g. 14 August 2026 — Independence Day",
      "Buffer time between appointments, configurable per salon",
    ],
    layout: "text-left",
    preview: makePreview("hours"),
  },
  {
    id: "module-services",
    eyebrow: "Keep your catalog current",
    title: "Services Catalog",
    description:
      "Manage every service in one place — the single source of truth for what Recepta quotes in WhatsApp. Add services, set prices and durations, turn services on or off. Change a price and the bot quotes the new price next time.",
    bullets: [
      "Service name, category, duration, and price per row",
      "Disable a service without deleting it — bot won't offer it",
      "Edit a price once; Recepta quotes the new price automatically",
    ],
    layout: "text-right",
    preview: makePreview("services"),
  },
  {
    id: "module-staff",
    eyebrow: "Manage your team",
    title: "Staff Allocation",
    description:
      "Add your staff, define their specialties and working days. Recepta uses this information to route bookings to the right stylist and respect each team member's availability.",
    bullets: [
      "Staff member with role, specializations, and working days",
      "Add or edit any team member — changes apply immediately",
      "Routing uses skills + working days to pick the right stylist",
    ],
    layout: "text-left",
    preview: makePreview("staff"),
  },
  {
    id: "module-escalations",
    eyebrow: "Only step in when needed",
    title: "Escalations",
    description:
      "When Recepta needs you, it tells you. Complaints, refund requests, sensitive issues, and conversations the AI isn't confident about land here with full context — ready for you to take over or mark resolved.",
    bullets: [
      "Active vs Resolved tabs so the queue stays small",
      "Reason badge (Refund, Complaint, Medical, Low confidence…)",
      "Take Over Chat disables the AI for that conversation",
    ],
    layout: "text-right",
    preview: makePreview("escalations"),
  },
  {
    id: "module-ai-rules",
    eyebrow: "Control how your AI works",
    title: "Agent Rules",
    description:
      "Turn predefined AI behaviors on or off without writing complicated prompts. Recepta ships with a library of behaviors — discount handling, late-arrival tolerance, refund window, escalation triggers — you pick which ones apply to your salon.",
    bullets: [
      "Nine predefined behavioral rules, all togglable",
      "Five escalation triggers for sensitive conversations",
      "Test sandbox shows how the bot replies with your toggles",
    ],
    layout: "text-left",
    preview: makePreview("aiRules"),
  },
];

export function ProductTour() {
  return (
    <section
      id="product"
      // No opaque background — the page-level gradient flows through this
      // section continuously. The soft teal radial glow at the top is the
      // only atmospheric layer, providing visual continuity without
      // painting over the page canvas.
      className="relative overflow-hidden"
    >
      {/* Soft teal radial glow — atmospheric depth that fades down into
          the page gradient. Pointer-events-none so it never blocks
          interaction. aria-hidden so screen readers ignore it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_at_top,oklch(0.94_0.04_195_/_0.32)_0%,transparent_65%)]"
      />
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
        <SectionReveal
          cadence={0.1}
          className="mx-auto max-w-2xl text-center"
          eyebrow={
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              The product, end to end
            </div>
          }
          heading={
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              Everything <span className="text-gradient-luxe">your salon</span> configures, in one place.
            </h2>
          }
          description={
            <p className="mt-4 text-lg text-muted-foreground">
              Here are the actual screens you'll use after signing up — services, hours, bookings, escalations,
              and the rules your AI receptionist follows.
            </p>
          }
        />

        <div className="mt-12 md:mt-16">
          {productModules.map((m) => (
            <ProductModuleShowcase key={m.id} module={m} />
          ))}
        </div>
      </div>
    </section>
  );
}