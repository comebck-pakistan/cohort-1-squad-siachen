// ---------------------------------------------------------------------------
// Motion tokens — central vocabulary for the landing page.
//
// Every duration / spring / easing in the motion system is sourced from here.
// Per the brief: "Do not animate purely decorative text continuously" and
// "Avoid animating width/height/top/left" — these tokens encode fast and
// subtle, not slow and theatrical.
//
// Reduced-motion path: callers consult useReducedMotion() and snap to the
// identity transform (see ReducedMotionGate at call sites). We don't zero-out
// durations — vanishing animations feel worse than no animations.
// ---------------------------------------------------------------------------

/** Standard duration scale (seconds). Mirrors the brief's "fast micro / standard / section reveal" tiers. */
export const DURATION = {
  micro: 0.15,        // hovers, presses, icon rotations
  fast: 0.25,         // small in/out (chat bubble, badge swap)
  standard: 0.4,      // card lifts, nav indicator slide
  section: 0.7,       // section reveals
  slow: 1.2,          // ambient loops (aurora drift, float)
} as const;

/** Easing curves. Use ease-out for entrances, ease-in for exits, standard for state changes. */
export const EASE = {
  // Material-style standard curve — symmetric feel, works for most transitions
  standard: [0.4, 0.0, 0.2, 1] as const,
  // Decelerate — for elements entering (reveal)
  out: [0.0, 0.0, 0.2, 1] as const,
  // Accelerate — for elements leaving
  in: [0.4, 0.0, 1, 1] as const,
  // Apple-style spring-ish curve for playful moments
  emphasized: [0.2, 0.0, 0, 1] as const,
} as const;

/** Spring presets for when we need actual physics (cursor parallax, magnetic hover). */
export const SPRING = {
  // Soft, slow — ambient / parallax
  soft: { type: "spring", stiffness: 120, damping: 20, mass: 1 } as const,
  // Bouncy but controlled — magnetic buttons
  bounce: { type: "spring", stiffness: 260, damping: 22, mass: 0.8 } as const,
  // Snappy — micro interactions
  snappy: { type: "spring", stiffness: 400, damping: 30, mass: 0.5 } as const,
} as const;

/** Distance tokens (px) — keeps translateY/translateX consistent across the site. */
export const OFFSET = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

/** Hover lift — subtle, per the brief ("3–5px vertical lift"). */
export const HOVER_LIFT_PX = 4;

/** Magnetic button max cursor pull — per the brief ("approximately 4–6px"). */
export const MAGNETIC_MAX_PX = 5;

/** Cursor parallax on hero cards — very small. */
export const PARALLAX_MAX_PX = 6;

/** Aurora blob float — WhatsApp card. Calendar card uses different timing, not distance. */
export const FLOAT_DISTANCE_PX = 6;