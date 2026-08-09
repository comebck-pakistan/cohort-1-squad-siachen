// Barrel re-exports for the motion system.
// Prefer importing from here so call sites stay short.

export { DURATION, EASE, SPRING, OFFSET, HOVER_LIFT_PX, MAGNETIC_MAX_PX, PARALLAX_MAX_PX, FLOAT_DISTANCE_PX } from "./tokens";
export { Reveal } from "./Reveal";
export { FadeIn } from "./FadeIn";
export { Stagger, StaggerItem } from "./Stagger";
export { SectionReveal } from "./SectionReveal";
export { HoverCard } from "./HoverCard";
export { MagneticButton } from "./MagneticButton";
export { ScrollProgress } from "./ScrollProgress";
export { AuroraBackground } from "./AuroraBackground";
export { useActiveSection } from "./useActiveSection";
export { useBoundedCycle } from "./useBoundedCycle";
export { HeroProductDemo } from "./HeroProductDemo";
export { SmoothScroll } from "./SmoothScroll";