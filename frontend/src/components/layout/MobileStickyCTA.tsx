import { useEffect, useState } from "react";
import { useRouterState, Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// MobileStickyCTA — Wave 17 (production-readiness pass).
//
// Persistent "Start free trial" bar on mobile, fixed to the bottom of the
// viewport. Hidden on /  (md and up) and on routes where it would cover
// form fields or be redundant (auth, payment, salon portal, superadmin).
//
// The bar auto-hides when the hero's own "Start free trial" CTA enters
// the viewport (no need to show two CTAs at once). It also fades out
// when the user has scrolled to within 200px of the page bottom — they
// are about to see the footer anyway.
//
// All decisions in the user's PR brief are implemented:
//   - md:hidden only (no desktop tab)
//   - "Start free trial" only (no second CTA option)
//   - hidden on: /onboarding, /login, /payment, /payment-success,
//     /superadmin/*, /salon-portal/*, /waitlist, /privacy, /terms
//   - IntersectionObserver drives the show/hide based on hero CTA
//   - ≥48px tap target
//   - Smooth fade in/out
// ---------------------------------------------------------------------------

// Routes where the sticky CTA would either be redundant (the user is
// already converting) or would cover form inputs. Keep this list in sync
// with __root.tsx's NotFoundComponent — anywhere auth, payment, or a
// dashboard is in the way, hide the bar.
const HIDE_PREFIXES = [
  "/onboarding",
  "/login",
  "/payment",
  "/superadmin",
  "/salon-portal",
  "/waitlist",
  "/privacy",
  "/terms",
];

// Pages where the bar is shown. The bar is purely a public-marketing
// conversion driver — it does not appear once the user is inside the
// product.
const SHOW_PATHS = new Set<string>(["/"]);

function shouldShowOnPath(pathname: string): boolean {
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  return SHOW_PATHS.has(pathname);
}

export function MobileStickyCTA() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [heroVisible, setHeroVisible] = useState(true);
  const [nearFooter, setNearFooter] = useState(false);

  // Watch the hero CTA — when it enters the viewport, the sticky bar
  // hides (we don't need two CTAs at once). When it leaves, the bar
  // reappears. We pick `.hero-cta` as the marker class so this stays
  // robust to copy changes. Add `hero-cta` to the primary CTA button on
  // the landing hero.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const target = document.querySelector<HTMLElement>(".hero-cta");
    if (!target) {
      // No hero on this page — keep the bar in its default-visible
      // state. The path filter below handles non-landing routes.
      setHeroVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setHeroVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [pathname]);

  // Watch the bottom of the document — when we're within 200px of the
  // very end, hide the bar so it doesn't overlap the footer's email
  // link or cover the "Made in Pakistan" line.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onScroll() {
      const scrollY = window.scrollY;
      const viewport = window.innerHeight;
      const fullHeight = document.documentElement.scrollHeight;
      setNearFooter(scrollY + viewport >= fullHeight - 200);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  const visible = shouldShowOnPath(pathname) && !heroVisible && !nearFooter;

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pt-2 transition-all duration-300 md:hidden ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <Link
        to="/onboarding"
        className="hero-cta-sticky flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-luxe text-base font-semibold text-white shadow-luxe ring-1 ring-white/20 backdrop-blur-md transition-transform active:scale-[0.98]"
      >
        <Sparkles className="size-4" />
        Start free trial
      </Link>
    </div>
  );
}
