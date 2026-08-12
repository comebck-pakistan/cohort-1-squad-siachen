import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// ProductModuleShowcase — Wave 12 Stage B
//
// One reusable component for "here is one Recepta module, with its label,
// explanation, and a media frame beside it." Alternates left/right per
// module so the page doesn't read as seven identical stacked cards.
//
// The eventual recording will sit inside ProductDemoFrame; for now we
// render a static placeholder using the same primitives Recepta uses in
// production (Card, Badge, Table, Switch, etc.) so visitors can evaluate
// the layout without us having to record media first.
//
// Architecture:
//   ProductModuleShowcase   ← alternates layout, owns spacing
//   ProductDemoFrame        ← owns the "app window" frame + dashboard header
//   productModules[]        ← typed data, easy to add/remove modules
//
// Module content (preview components, copy) lives in ProductModulePreviews
// alongside the data. The route passes everything via a ProductModule prop.
// ---------------------------------------------------------------------------

export type ProductModuleLayout = "text-left" | "text-right";

export interface ProductModule {
  /** Section anchor id for navbar / deep-link. */
  id: string;
  /** Eyebrow above the heading — short uppercase tag (e.g. "Set it up"). */
  eyebrow: string;
  /** Module name shown on the dashboard header strip. */
  title: string;
  /** 1–2 sentence explanation in Recepta's brand voice. */
  description: string;
  /** 3 short bullets, each a concrete capability. */
  bullets: string[];
  /** Which side the text is on for desktop. Mobile stacks regardless. */
  layout: ProductModuleLayout;
  /** Static preview rendered inside the frame. Uses real Recepta UI. */
  preview: ReactNode;
}

// ---------------------------------------------------------------------------
// ProductDemoFrame — the "this is a real Recepta screen" window.
//
// Mimics the dashboard chrome from TenantShell: Recepta brand mark + Owner
// Dashboard subtitle on the left, "Agent Live" pill on the right, page
// header with title and description. The actual media goes in children.
//
// Aspect ratio is ~16:10 to match a wide desktop browser. The frame uses
// the same Card + border + soft shadow tokens the dashboard uses
// (bg-white shadow-none border), so the frame itself feels like one more
// Recepta screen rather than a generic device mockup.
//
// When we drop in a real recording (mp4/webm), we just swap the children —
// the frame, sizing, and dashboard chrome stay identical.
// ---------------------------------------------------------------------------

export function ProductDemoFrame({
  moduleLabel,
  pageTitle,
  pageDescription,
  children,
  className,
}: {
  moduleLabel: string;
  pageTitle: string;
  pageDescription?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Frame: warm white surface, subtle border, soft shadow, generous radius.
        // aspect-[16/10] keeps all 7 modules consistent. bg-white + border matches
        // the dashboard Card primitive so it feels like one more Recepta screen.
        "relative w-full overflow-hidden rounded-2xl border border-border/70 bg-white text-foreground shadow-[0_1px_2px_oklch(0.2_0.02_40_/_0.06),0_30px_60px_-30px_oklch(0.45_0.10_195_/_0.25)]",
        className,
      )}
    >
      {/* Dashboard chrome — mirrors TenantShell's brand row + nav so visitors
          recognize the product immediately. Not interactive. */}
      <div className="flex items-center justify-between gap-3 border-b bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-semibold text-primary">
              Recepta
            </div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              Owner Dashboard
            </div>
          </div>
          <span className="ml-3 hidden h-4 w-px bg-border sm:block" />
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            {moduleLabel}
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
          <span className="size-1.5 rounded-full bg-primary-foreground" />
          Agent Live
        </div>
      </div>

      {/* Page header — title + description. Identical to the dashboard. */}
      <div className="border-b bg-white px-5 py-3">
        <div className="font-display text-base font-semibold tracking-tight text-foreground">
          {pageTitle}
        </div>
        {pageDescription && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {pageDescription}
          </div>
        )}
      </div>

      {/* Media area — children carry the actual demo / placeholder. We pad
          generously and let the preview self-size to its content. The
          background shifts to bg-background/40 so nested cards (which use
          bg-white) read as elevated above the page surface. */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-background/40">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlaceholderBadge — small marker on top-left of the media. Communicates
// "this is a placeholder until we record the real workflow" without
// dominating the frame. Will be removed in Stage C when real media lands.
// ---------------------------------------------------------------------------

export function PlaceholderBadge({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur">
      <span className="size-1 rounded-full bg-muted-foreground/60" />
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProductModuleShowcase — the public reusable component.
//
// Renders one module: a 2-col grid on desktop (text | frame), stacking on
// mobile. SectionReveal handles entrance. Module-level id lets the navbar
// (or future anchor links) deep-link into it.
// ---------------------------------------------------------------------------

export function ProductModuleShowcase({ module }: { module: ProductModule }) {
  const textLeft = module.layout === "text-left";

  return (
    <section
      id={module.id}
      // Generous vertical padding between modules. py-20 on desktop, py-12
      // on mobile so the page rhythm stays comfortable at any width.
      className="scroll-mt-24 py-12 md:py-20"
      aria-labelledby={`${module.id}-heading`}
    >
      {/* Desktop: 2-col grid (text | frame), alternating via flex order. */}
      <div
        className={cn(
          "grid items-center gap-10 md:grid-cols-2 md:gap-12 lg:gap-16",
        )}
      >
        {/* Text column */}
        <div className={cn("min-w-0", textLeft ? "md:order-1" : "md:order-2")}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            {module.eyebrow}
          </div>
          <h3
            id={`${module.id}-heading`}
            className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl"
          >
            {module.title}
          </h3>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
            {module.description}
          </p>
          <ul className="mt-6 space-y-2.5">
            {module.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                />
                <span className="text-foreground/80">{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Frame column */}
        <div className={cn("min-w-0", textLeft ? "md:order-2" : "md:order-1")}>
          {module.preview}
        </div>
      </div>
    </section>
  );
}