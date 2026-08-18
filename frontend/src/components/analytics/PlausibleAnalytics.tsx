// ---------------------------------------------------------------------------
// PlausibleAnalytics — Wave 17 (production-readiness pass).
//
// Plausible is cookieless and GDPR-friendly out of the box, so we do not
// gate this behind a consent banner. We only render the script in the
// browser (after hydration) and only when a domain key has been provided
// via VITE_PLAUSIBLE_DOMAIN. If the env var is absent the component
// renders nothing — useful for local dev.
//
// Plausible does not use cookies and does not collect personal data, so
// no consent banner is required under GDPR / ePrivacy / Pakistan PDPA.
// Reference: https://plausible.io/data-policy
// ---------------------------------------------------------------------------

import { useEffect } from "react";

const PLAUSIBLE_DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN as
  | string
  | undefined;
const PLAUSIBLE_HOST = (import.meta.env.VITE_PLAUSIBLE_HOST as
  | string
  | undefined) ?? "https://plausible.io";

export function PlausibleAnalytics() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!PLAUSIBLE_DOMAIN) return; // dev / unconfigured → no-op
    if (document.querySelector('script[data-plausible]')) return; // dedupe

    const script = document.createElement("script");
    script.defer = true;
    script.dataset.plausible = "true";
    script.src = `${PLAUSIBLE_HOST}/js/script.js`;
    script.setAttribute("data-domain", PLAUSIBLE_DOMAIN);
    document.head.appendChild(script);
  }, []);

  return null;
}
