// ---------------------------------------------------------------------------
// ProductDemoSequence — runs a typed phase loop inside a ProductDemoFrame.
//
// The ProductTour section is the guided tour of the real Recepta product.
// Each interactive module tells a story: "owner configures once → AI uses
// it → customer receives correct answer." That message is hard to
// communicate with a static screenshot, so this component runs a 6-10s loop
// INSIDE the existing ProductDemoFrame chrome.
//
// IMPORTANT: the loop animates the REAL dashboard UI itself, not a separate
// fake chat strip beside it. The preview component receives the current
// phase index via a render-prop and decides how the dashboard UI should
// change at each beat — row insertions, badge swaps, toggle flips, button
// highlights. This makes the page feel like the actual Recepta product
// rather than a marketing mockup with bubble narration.
//
// Architecture:
//
//   ProductDemoSequence        — public component, owns the frame +
//                                reduced-motion fallback + render-prop
//                                bridge to the preview.
//   useDemoSequence            — phase ticker with IntersectionObserver
//                                pause; returns { phase, isReduced, ref }.
//
// The loop pauses when the host element scrolls off-screen (saves CPU on
// the 5 modules that build this section). When prefers-reduced-motion is
// on, the loop is suppressed and the rest phase is shown statically.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ProductDemoFrame } from "./ProductModuleShowcase";
import { useDemoSequence } from "./useDemoSequence";

/**
 * A single beat in the phase loop.
 *
 * The dashboard preview decides what to do at each phase. The phase id is
 * stable across renders so preview components can key animations off it.
 */
export interface SequencePhase {
  id: string;
  durationMs: number;
}

export interface ProductDemoSequenceProps {
  phases: SequencePhase[];
  /** Frame props — pass through to ProductDemoFrame. */
  moduleLabel: string;
  pageTitle: string;
  pageDescription?: string;
  /**
   * Render-prop: receives `{ phase: number, reduced: boolean }` and returns
   * the dashboard UI. The preview decides how its UI changes at each beat.
   */
  children: (args: { phase: number; reduced: boolean }) => ReactNode;
  /** Phase index to render statically when reduced-motion is on. Default = 0 (baseline). */
  restPhaseIndex?: number;
  /** Optional className on the outer wrapper. */
  className?: string;
}

/**
 * ProductDemoSequence — public component.
 *
 * The render-prop is called with the current phase index. The preview uses
 * it to drive real UI state transitions: row insertions, badge swaps,
 * toggle flips, button highlights. No chat narration overlay.
 */
export function ProductDemoSequence({
  phases,
  moduleLabel,
  pageTitle,
  pageDescription,
  children,
  restPhaseIndex,
  className,
}: ProductDemoSequenceProps) {
  const lastIndex = Math.max(0, phases.length - 1);
  const { phase, ref, isReduced } = useDemoSequence({
    phaseCount: phases.length,
    durations: phases.map((p) => p.durationMs),
    restPhaseIndex: restPhaseIndex ?? 0,
  });

  // Reduced-motion: jump to the rest phase and render the dashboard in its
  // "settled" state. No animation, no looping.
  const effectivePhase = isReduced ? (restPhaseIndex ?? 0) : phase;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <ProductDemoFrame
        moduleLabel={moduleLabel}
        pageTitle={pageTitle}
        pageDescription={pageDescription}
      >
        {children({ phase: effectivePhase, reduced: isReduced })}
      </ProductDemoFrame>
    </div>
  );
}