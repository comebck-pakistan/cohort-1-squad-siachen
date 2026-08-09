// ---------------------------------------------------------------------------
// FadeIn — one-shot mount fade. No viewport trigger, no scroll dependency.
//
// Use for: hero entrance, page-level mount (navbar, footer), elements
// above the fold that should animate in immediately.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { DURATION, EASE, OFFSET } from "./tokens";

interface FadeInProps {
  children: ReactNode;
  /** Translate distance (px). Default = sm. */
  y?: number;
  /** Delay before animation starts (seconds). */
  delay?: number;
  className?: string;
}

export function FadeIn({
  children,
  y = OFFSET.sm,
  delay = 0,
  className,
}: FadeInProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DURATION.standard,
        delay,
        ease: EASE.out,
      }}
    >
      {children}
    </motion.div>
  );
}