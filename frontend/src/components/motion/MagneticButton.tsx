// ---------------------------------------------------------------------------
// MagneticButton — desktop-only cursor-attracted CTA.
//
// The button subtly follows the cursor when it's near. Max pull ~5px (per
// the brief). On touch devices and reduced-motion environments it behaves
// like a normal button (no magnetic pull).
//
// Implementation: motion values driven by mousemove, smoothed with a spring.
// The button itself doesn't need to know it's wrapped — we pass children
// through unchanged.
// ---------------------------------------------------------------------------

import { motion, useMotionValue, useSpring, useReducedMotion } from "motion/react";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { MAGNETIC_MAX_PX, SPRING } from "./tokens";

interface MagneticButtonProps {
  children: ReactNode;
  className?: string;
  /** Strength of the pull (0-1). Default 0.3 — 30% of cursor distance applied to button. */
  strength?: number;
  /** Override the max pull distance (px). Default = MAGNETIC_MAX_PX. */
  maxPull?: number;
  /** Optional click handler forwarded to children if they support onClick. */
  onClick?: () => void;
  asChild?: boolean;
}

export function MagneticButton({
  children,
  className,
  strength = 0.3,
  maxPull = MAGNETIC_MAX_PX,
  onClick,
  asChild,
}: MagneticButtonProps) {
  const prefersReducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [isCoarse, setIsCoarse] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Smooth the raw cursor motion values so the pull doesn't jitter.
  const springX = useSpring(x, SPRING.soft);
  const springY = useSpring(y, SPRING.soft);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsCoarse(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsCoarse(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (isCoarse || prefersReducedMotion) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    // Distance from cursor to button center
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = (e.clientX - centerX) * strength;
    const dy = (e.clientY - centerY) * strength;
    // Clamp to maxPull so the button never wanders too far from its slot.
    x.set(Math.max(-maxPull, Math.min(maxPull, dx)));
    y.set(Math.max(-maxPull, Math.min(maxPull, dy)));
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  // Coarse pointer or reduced-motion → plain wrapper, no pull.
  if (isCoarse || prefersReducedMotion) {
    return (
      <div ref={ref} className={className} onClick={onClick}>
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
      onClick={onClick}
      style={{
        x: springX,
        y: springY,
        // will-change keeps the layer hot so the spring doesn't repaint on every frame.
        willChange: "transform",
      }}
    >
      {asChild ? children : <div className="inline-block">{children}</div>}
    </motion.div>
  );
}