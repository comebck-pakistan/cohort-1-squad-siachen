// ---------------------------------------------------------------------------
// AuroraBackground — slow-drifting cream + teal blobs.
//
// Replaces the static blob div currently in the hero. Three blobs, each on
// its own loop with a different period so they never line up. Low opacity,
// large blur — feels like ambient light, not animation.
//
// Per the brief: "Do NOT use neon, cyberpunk, starfields, aggressive
// particles, strong WebGL, rainbow gradients." This is plain CSS gradients
// animated via Motion's transform — no canvas, no WebGL, no particles.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "motion/react";
import { DURATION } from "./tokens";

interface AuroraBackgroundProps {
  className?: string;
}

export function AuroraBackground({ className }: AuroraBackgroundProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    // Static gradient — no movement, still the brand warmth.
    return (
      <div
        className={className}
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(520px circle at 33% 10%, oklch(0.92 0.05 195 / 0.4), transparent 60%), radial-gradient(400px circle at 100% 40%, oklch(0.93 0.04 75 / 0.35), transparent 60%)",
        }}
      />
    );
  }

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      <Blob
        size={520}
        topPct={-10}
        leftPct={33}
        color="oklch(0.92 0.05 195 / 0.4)" // muted green
        duration={DURATION.slow * 14}
        offsetX={60}
        offsetY={30}
      />
      <Blob
        size={400}
        topPct={30}
        leftPct={100}
        color="oklch(0.93 0.04 75 / 0.35)" // soft warm cream
        duration={DURATION.slow * 18}
        offsetX={-50}
        offsetY={40}
      />
      <Blob
        size={340}
        topPct={70}
        leftPct={15}
        color="oklch(0.94 0.04 90 / 0.3)" // warm cream
        duration={DURATION.slow * 22}
        offsetX={40}
        offsetY={-30}
      />
    </div>
  );
}

interface BlobProps {
  size: number;
  topPct: number;
  leftPct: number;
  color: string;
  /** Full loop period in seconds. */
  duration: number;
  /** Max horizontal drift (px). */
  offsetX: number;
  /** Max vertical drift (px). */
  offsetY: number;
}

function Blob({
  size,
  topPct,
  leftPct,
  color,
  duration,
  offsetX,
  offsetY,
}: BlobProps) {
  return (
    <motion.div
      style={{
        position: "absolute",
        top: `${topPct}%`,
        left: `${leftPct}%`,
        width: size,
        height: size,
        borderRadius: "9999px",
        background: color,
        filter: "blur(80px)",
        // will-change keeps the layer hot so transform-only animation doesn't repaint.
        willChange: "transform",
      }}
      // Two-keyframe loop using repeatType:mirror so the motion is smooth at the boundary.
      animate={{
        x: [0, offsetX, 0, -offsetX, 0],
        y: [0, offsetY, 0, -offsetY, 0],
      }}
      transition={{
        duration,
        ease: "easeInOut",
        repeat: Infinity,
        repeatType: "mirror",
      }}
    />
  );
}