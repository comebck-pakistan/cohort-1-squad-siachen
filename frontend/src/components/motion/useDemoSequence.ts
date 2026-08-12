// ---------------------------------------------------------------------------
// useDemoSequence — drive a typed phase loop for product-tour mini-demos.
//
// Mirrors the useDemoAnimation pattern in HeroDashboardPreview.tsx but is
// payload-aware (the wire shape lives in ProductDemoSequence.tsx, not here)
// and IntersectionObserver-aware: the loop pauses when the host element
// scrolls off-screen so we don't burn CPU on 5 simultaneous demo timers.
//
// Behavior summary:
//   - prefers-reduced-motion → parks on `restPhaseIndex`, never advances
//   - not in viewport        → pauses on the current phase
//   - in viewport            → advances to next phase after `durations[phase]`
//   - phase wraps at `phaseCount`; loops indefinitely
//
// The caller owns the phase data (durations + payload); this hook only
// orchestrates the cycle. Cleanup returns from the timer effect so the
// chain unwinds on unmount.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

export interface DemoSequenceOptions {
  phaseCount: number;
  durations: number[];
  restPhaseIndex?: number;
}

export function useDemoSequence({
  phaseCount,
  durations,
  restPhaseIndex = 0,
}: DemoSequenceOptions) {
  const prefersReducedMotion = useReducedMotion();
  const reduced = !!prefersReducedMotion;
  const [phase, setPhase] = useState<number>(reduced ? restPhaseIndex : 0);
  const [isInView, setIsInView] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  // IntersectionObserver — fires when the host crosses 20% in viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Phase ticker — skip when reduced motion or scrolled off-screen.
  useEffect(() => {
    if (reduced || !isInView || phaseCount === 0) return undefined;
    const duration = durations[phase] ?? 0;
    if (duration <= 0) return undefined;
    const timer = setTimeout(() => {
      setPhase((p) => (p + 1) % phaseCount);
    }, duration);
    return () => clearTimeout(timer);
  }, [phase, phaseCount, durations, reduced, isInView]);

  // If reduced-motion flips on mid-cycle, snap to the rest phase so we
  // don't leave the visitor staring at a half-played state.
  useEffect(() => {
    if (reduced && phase !== restPhaseIndex) {
      setPhase(restPhaseIndex);
    }
  }, [reduced, phase, restPhaseIndex]);

  return { phase, ref, isReduced: reduced, isInView };
}
