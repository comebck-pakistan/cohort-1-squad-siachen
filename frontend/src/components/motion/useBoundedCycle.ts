// ---------------------------------------------------------------------------
// useBoundedCycle — runs a stepped demo for a bounded number of cycles, then
// parks on the final phase. Resets when the `playKey` argument changes.
//
// Use for: HowItWorks per-step demos and any other small repeating animation
// that should feel intentional rather than like a looping advertisement.
//
// Behavior:
//   - On mount (and whenever playKey changes), starts at phase 0.
//   - Each cycle advances phase by 1 every `intervalMs`. After `cycles` full
//     cycles, parks on the final phase (no more advances).
//   - If prefers-reduced-motion is true, parks on the calmest phase and
//     never advances.
//   - Cleans up its interval on unmount or playKey change.
//
// Final phase is whatever the consumer considers calmest. The hook itself
// just tracks `phase ∈ [0, phaseCount)` and stops calling setState.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

interface BoundedCycleOptions {
  /** Number of distinct phases the demo cycles through. */
  phaseCount: number;
  /** Phase index to park on when reduced motion is enabled or cycles are done. */
  restPhase?: number;
  /** How many full cycles to run before parking. Default 3. */
  cycles?: number;
  /** Time per phase in ms. Default 2200. */
  intervalMs?: number;
}

export function useBoundedCycle(
  playKey: string | number,
  {
    phaseCount,
    restPhase = 0,
    cycles = 3,
    intervalMs = 2200,
  }: BoundedCycleOptions,
): number {
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState(restPhase);

  useEffect(() => {
    // Reduced motion: park on the calmest phase and don't advance.
    if (prefersReducedMotion) {
      setPhase(restPhase);
      return;
    }
    // Reset to 0 whenever playKey changes — re-entering a step restarts the demo.
    setPhase(0);
    const totalPhases = cycles * phaseCount;
    let tick = 0;
    const id = setInterval(() => {
      tick += 1;
      // Park once we've shown enough phases.
      if (tick >= totalPhases) {
        setPhase(restPhase);
        // Self-clear so we stop scheduling ticks.
        clearInterval(id);
        return;
      }
      setPhase((p) => (p + 1) % phaseCount);
    }, intervalMs);
    return () => clearInterval(id);
  }, [playKey, prefersReducedMotion, phaseCount, cycles, intervalMs, restPhase]);

  return phase;
}