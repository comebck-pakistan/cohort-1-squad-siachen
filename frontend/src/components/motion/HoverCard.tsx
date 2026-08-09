// ---------------------------------------------------------------------------
// HoverCard — interactive feature/pricing card with hover lift + cursor spotlight.
//
// Rest: static.
// Hover: 1-2% scale, 3-5px lift, border/shadow change.
// Press: subtle scale-down.
// Cursor: optional radial spotlight that follows the cursor (CSS gradient
//         masked to the card — keeps it cheap).
//
// Respects prefers-reduced-motion and disables the cursor spotlight on
// mobile (no hover state on touch devices).
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "motion/react";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { DURATION, EASE, HOVER_LIFT_PX } from "./tokens";

interface HoverCardProps {
  children: ReactNode;
  className?: string;
  /** Disable the cursor spotlight (e.g., for dense pricing cards). */
  noSpotlight?: boolean;
  /** Override hover lift (px). Default = HOVER_LIFT_PX. */
  liftPx?: number;
}

export function HoverCard({
  children,
  className,
  noSpotlight,
  liftPx = HOVER_LIFT_PX,
}: HoverCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [isCoarse, setIsCoarse] = useState(false);

  // Detect coarse pointer (touch devices) — skip cursor spotlight on mobile.
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsCoarse(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsCoarse(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (noSpotlight || isCoarse || prefersReducedMotion) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseLeave = () => setPos(null);

  if (prefersReducedMotion) {
    return (
      <div ref={ref} className={className} onMouseLeave={handleMouseLeave}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      // whileHover is on the wrapper; transitions are controlled via animate state.
      whileHover={{ y: -liftPx, scale: 1.015 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: DURATION.fast, ease: EASE.standard }}
      style={{
        // Cursor spotlight as background gradient — opacity flips with hover state.
        // Cheaper than masking because it's a CSS paint, no JS reads per frame.
        backgroundImage: pos
          ? `radial-gradient(220px circle at ${pos.x}px ${pos.y}px, rgba(255,255,255,0.35), transparent 60%)`
          : undefined,
        // will-change promotes the card to its own layer so scale doesn't repaint siblings.
        willChange: "transform",
      }}
    >
      {children}
    </motion.div>
  );
}