// ---------------------------------------------------------------------------
// useActiveSection — track which on-page section is currently in the viewport.
//
// Used by the Navbar to decide which link gets the sliding layout indicator.
// Implementation: a single IntersectionObserver watches all section refs at
// once; the active id is whichever section has the largest intersection
// ratio (weighted toward sections closer to the viewport center).
//
// The brief's requirements: "Active section indicator — Features, How it
// works, Pricing, FAQ" with "a shared Motion layout indicator rather than
// separate animated underlines."
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

interface UseActiveSectionOptions {
  /** Section ids to watch. The first one is treated as the initial active. */
  ids: string[];
  /** rootMargin — narrows the observer's effective viewport. Default biases toward the upper half. */
  rootMargin?: string;
}

export function useActiveSection({
  ids,
  rootMargin = "-30% 0px -50% 0px",
}: UseActiveSectionOptions): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Collect refs to every section. Missing ids are silently ignored so the
    // hook is safe to call before all sections mount.
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (sections.length === 0) return;

    // Track intersection ratios per id so we can pick the most-visible one.
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target.id, entry.intersectionRatio);
        }
        // Pick the id with the highest ratio; ties go to whichever appears
        // first in `ids` (i.e., the order they appear in the document).
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const id of ids) {
          const r = ratios.get(id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        }
        if (bestId) setActive(bestId);
      },
      {
        rootMargin,
        // Multiple thresholds so the ratio updates smoothly as the section crosses the band.
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [ids, rootMargin]);

  return active;
}