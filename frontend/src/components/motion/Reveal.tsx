// ---------------------------------------------------------------------------
// Reveal — the workhorse viewport-triggered reveal.
//
// Wraps content in a motion.div that fades + translates up when it enters
// the viewport. Respects prefers-reduced-motion: collapses to instant in.
//
// Use for: section blocks, individual cards, hero sub-elements.
// For a stagger of multiple children, use <Stagger> instead — it composes
// several <Reveal> instances and uses Motion's parent variants.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { DURATION, EASE, OFFSET } from "./tokens";

interface RevealProps {
  children: ReactNode;
  /** Override translate distance (px). Default = md. */
  y?: number;
  /** Animation delay in seconds. */
  delay?: number;
  /** Trigger only once (default) or every time the element re-enters. */
  once?: boolean;
  /** Viewport margin for the IntersectionObserver. Default "-15%". */
  margin?: string;
  className?: string;
}

export function Reveal({
  children,
  y = OFFSET.md,
  delay = 0,
  once = true,
  margin = "-15%",
  className,
}: RevealProps) {
  const prefersReducedMotion = useReducedMotion();

  // Snap to identity transform for reduced-motion users — no translate, no fade.
  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: margin as `${number}%` }}
      transition={{
        duration: DURATION.section,
        delay,
        ease: EASE.out,
      }}
    >
      {children}
    </motion.div>
  );
}