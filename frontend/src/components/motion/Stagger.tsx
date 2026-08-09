// ---------------------------------------------------------------------------
// Stagger — orchestrates a list of children to reveal in sequence.
//
// Children must be wrapped in <StaggerItem> (which is just a Reveal that
// reads the parent's variants context). We use Motion's variant propagation
// so the parent controls the cadence.
//
// Use for: feature card grids, pricing tiers, FAQ list, footer columns.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { DURATION, EASE, OFFSET } from "./tokens";

interface StaggerProps {
  children: ReactNode;
  /** Per-child delay (seconds). Default = 0.08s. Brief says "subtle staggered timing". */
  staggerChildren?: number;
  /** Delay before the first child fires (seconds). */
  delayChildren?: number;
  className?: string;
}

export function Stagger({
  children,
  staggerChildren = 0.08,
  delayChildren = 0,
  className,
}: StaggerProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-15%" }}
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren,
            delayChildren,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  y?: number;
  className?: string;
}

export function StaggerItem({
  children,
  y = OFFSET.md,
  className,
}: StaggerItemProps) {
  return (
    <motion.div
      className={className}
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