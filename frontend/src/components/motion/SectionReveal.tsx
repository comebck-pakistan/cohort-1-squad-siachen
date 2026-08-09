// ---------------------------------------------------------------------------
// SectionReveal — opinionated cascade for a section's heading block.
//
// Per the brief: "Use hierarchy: eyebrow → heading → description → content"
// with staggered reveals. This is the default shape for every major section
// in the landing page (Features, How it works, Pricing, FAQ).
//
// Each child gets its own delay; you pass them as props in order and they
// cascade in. Or wrap content as `children` and only animate the heading
// trio separately.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { DURATION, EASE, OFFSET } from "./tokens";

interface SectionRevealProps {
  eyebrow?: ReactNode;
  heading?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Per-element delay multiplier. Default 0.1s — brief says "subtle staggered". */
  cadence?: number;
  className?: string;
}

export function SectionReveal({
  eyebrow,
  heading,
  description,
  children,
  cadence = 0.1,
  className,
}: SectionRevealProps) {
  const prefersReducedMotion = useReducedMotion();

  // For reduced motion: render flat (no wrapping motion.div so no layout shift).
  if (prefersReducedMotion) {
    return (
      <div className={className}>
        {eyebrow}
        {heading}
        {description}
        {children}
      </div>
    );
  }

  // We need the parent in-view trigger to fire all children at once.
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-15%" }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: cadence } },
      }}
    >
      {eyebrow && (
        <SectionLine y={OFFSET.xs}>{eyebrow}</SectionLine>
      )}
      {heading && (
        <SectionLine y={OFFSET.sm}>{heading}</SectionLine>
      )}
      {description && (
        <SectionLine y={OFFSET.sm}>{description}</SectionLine>
      )}
      {children}
    </motion.div>
  );
}

function SectionLine({
  children,
  y,
}: {
  children: ReactNode;
  y: number;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: DURATION.section, ease: EASE.out },
        },
      }}
    >
      {children}
    </motion.div>
  );
}