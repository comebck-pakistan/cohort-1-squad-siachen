import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Mail, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";

// ---------------------------------------------------------------------------
// /payment/success — confirmation page after submission.
//
// Stores the requestId + email in the URL so the customer can return later
// to check status. Backend doesn't email them yet (out of scope for MVP).
//
// CTAs route by identity:
//   - Logged-in salon owner → /salon-portal/subscription (so the
//     refreshed plan tier is one click away, not the public landing)
//   - Public visitor → / (the landing page)
//
// The same logic applies to the header "Back to home" link in the top
// right — we don't want to dump an owner who just paid into the public
// marketing site.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/payment-success")({
  head: () => ({
    meta: [{ title: "Payment received · Recepta" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === "string" ? search.id : "",
    email: typeof search.email === "string" ? search.email : "",
  }),
  component: PaymentSuccessPage,
});

function PaymentSuccessPage() {
  const { id, email } = Route.useSearch();
  const tenant = useTenantBusinessId();
  const isOwner = !!tenant.data?.userId;
  // Owners return to their subscription tab so they can see the new
  // status (and the superadmin's approval will land on the same page
  // when it's flipped). Public visitors go to the landing page.
  const destination = isOwner ? "/salon-portal/subscription" : "/";
  const destinationLabel = isOwner
    ? "Back to subscription"
    : "Back to home";

  return (
    <div className="min-h-screen bg-gradient-warm">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
              <Sparkles className="size-5" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">
              Recepta
            </span>
          </Link>
          <Link
            to={destination}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {destinationLabel}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-16 md:py-24">
        <div className="rounded-3xl border border-border/70 bg-card p-8 shadow-luxe text-center md:p-12">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100">
            <CheckCircle2 className="size-9 text-emerald-600" />
          </div>
          <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Payment received
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base text-muted-foreground">
            We're reviewing your payment now. You'll get an email at{" "}
            <span className="font-medium text-foreground">{email}</span> as
            soon as your subscription is active — usually within a few hours.
          </p>

          {isOwner && (
            <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-3 text-xs text-muted-foreground">
              We'll activate your subscription on{" "}
              <span className="font-medium text-foreground">
                {tenant.data?.businessName || "your salon"}
              </span>{" "}
              the moment we approve the receipt. You can track the status on
              the Subscription tab.
            </div>
          )}

          <div className="mt-8 rounded-2xl border border-border/60 bg-background/50 p-4 text-left">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Reference number
            </div>
            <div className="mt-1 font-mono text-sm text-foreground">{id}</div>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link to={destination}>{destinationLabel}</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={`mailto:hello@recepta.pk`}>
                <Mail className="mr-2 size-4" />
                Contact support
              </a>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
