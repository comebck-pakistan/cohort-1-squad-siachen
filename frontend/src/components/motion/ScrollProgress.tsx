// ---------------------------------------------------------------------------
// ScrollProgress — a thin top-edge progress indicator.
//
// Uses Motion's useScroll (target=window) + useTransform (scaleX 0→1) to
// show how far down the page the user is. Brand-colored, very small
// (h-0.5). Reduced-motion: still renders but transforms are skipped —
// actually the bar just stays at 0% for those users (it's purely
// informative, not decorative).
// ---------------------------------------------------------------------------

import { motion, useScroll, useSpring, useReducedMotion } from "motion/react";
import { SPRING } from "./tokens";

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const prefersReducedMotion = useReducedMotion();

  // Soften the raw scroll value so the bar doesn't jitter on tiny scroll deltas.
  const smoothed = useSpring(scrollYProgress, SPRING.soft);

  return (
    <motion.div
      aria-hidden="true"
      style={{
        scaleX: prefersReducedMotion ? 0 : smoothed,
        // Stick to the top, full width, behind any sticky headers (z-40).
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        transformOrigin: "0% 50%",
        background:
          "linear-gradient(90deg, oklch(0.85 0.08 70), oklch(0.63 0.11 195))",
        zIndex: 40,
        pointerEvents: "none",
      }}
    />
  );
}