// ---------------------------------------------------------------------------
// SmoothScroll — Lenis provider that gives the landing page a buttery scroll
// feel without breaking TanStack Router's scroll restoration or anchor
// navigation.
//
// How it integrates:
//   1. On mount, start a Lenis instance tied to the window scroll container.
//   2. Drive Lenis via its own rAF loop (it doesn't hook window scroll on its
//      own — you have to call lenis.raf() each frame).
//   3. Intercept clicks on anchor links (#features etc) and call
//      lenis.scrollTo(target) instead of letting the browser jump.
//   4. Respect prefers-reduced-motion — Lenis is paused (and clicks fall back
//      to native scroll behavior).
//
// Fallback: if anything throws during init (e.g. SSR), we silently no-op.
// The page still works — it just won't have smooth scroll.
// ---------------------------------------------------------------------------

import Lenis from "lenis";
import { useEffect, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";

export function SmoothScroll({ children }: { children: ReactNode }) {
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (typeof window === "undefined") return;

    // Construct Lenis. `lerp` controls smoothness — 0.1 is the Lenis default
    // and feels right for editorial copy.
    let lenis: Lenis | null = null;
    try {
      lenis = new Lenis({
        lerp: 0.1,
        // We don't want Lenis to fight with framer-motion's useScroll, which
        // also reads window.scrollY. Lenis exposes a `scroll` event that
        // mirrors window.scrollY, and motion's useScroll reads it natively.
        smoothWheel: true,
      });
    } catch (e) {
      // Lenis can throw if the DOM is in an unexpected state. Log + fall back.
      console.warn("[SmoothScroll] Lenis init failed; using native scroll", e);
      return;
    }

    let raf = 0;
    const tick = (time: number) => {
      lenis?.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Anchor-link interception — any <a href="#..."> uses Lenis.
    const handleClick = (e: MouseEvent) => {
      // Only left-click without modifier keys.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a[href^='#']") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const el = document.querySelector(href);
      if (!el) return;
      e.preventDefault();
      lenis?.scrollTo(el as HTMLElement, { offset: -72 }); // navbar height
    };
    document.addEventListener("click", handleClick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", handleClick);
      lenis?.destroy();
    };
  }, [prefersReducedMotion]);

  return <>{children}</>;
}