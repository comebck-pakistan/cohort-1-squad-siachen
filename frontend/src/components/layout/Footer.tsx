import { Link } from "@tanstack/react-router";
import { Sparkles, Mail } from "lucide-react";

// ---------------------------------------------------------------------------
// Footer — global (Wave 17: production-readiness pass).
//
// Extracted from the previous landing-only inline Footer in
// routes/index.tsx. Mounted in __root.tsx so it appears on every public
// route — privacy, terms, payment, login, etc.
//
// Content columns:
//   1. Brand    — Recepta + "Made in Pakistan" + legal entity
//   2. Product  — anchor links to landing-page sections (Features, How it
//                 works, Pricing, FAQ)
//   3. Company  — Privacy, Terms, Contact (mailto)
//   4. Support  — response time + email
//
// Two CTAs are explicitly absent because we don't have them yet:
//   - Phone number (per user instruction)
//   - WhatsApp button (same)
//
// If we add either, drop them in the right column.
// ---------------------------------------------------------------------------

const PRODUCT_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

const COMPANY_LINKS = [
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms of Service" },
  { to: "/waitlist", label: "Join the waitlist" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-border/60 bg-background/60 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-10 md:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2">
              <div className="grid size-8 place-items-center rounded-lg bg-gradient-luxe text-white">
                <Sparkles className="size-4" />
              </div>
              <span className="font-display text-base font-semibold">
                Recepta
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              The AI receptionist for salons in Pakistan. Books
              appointments on WhatsApp, in Urdu and English, 24/7.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              © {year} Squad Siachen Cohort 1 Comebck Pakistan
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Made in Pakistan 🇵🇰
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Product
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {PRODUCT_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="hover:text-foreground"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Company
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {COMPANY_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/login" className="hover:text-foreground">
                  Log in
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Support
            </h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Support via email, response within 24 hours.
            </p>
            <a
              href="mailto:hello@recepta.pk"
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              <Mail className="size-4" />
              hello@recepta.pk
            </a>
            <p className="mt-6 text-xs text-muted-foreground">
              Operating in Pakistan
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
