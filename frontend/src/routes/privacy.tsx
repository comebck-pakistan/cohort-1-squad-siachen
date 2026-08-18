import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, ShieldCheck, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// /privacy — Privacy Policy (Wave 17: production-readiness pass).
//
// Short, plain-language, MVP. No statute references, no legal
// scaffolding, no defined legal terms. Just a clear summary of what we
// collect, how we use it, who we share it with, how long we keep it,
// and how to reach us. If we ever need a fuller version we can ship
// v2; for now the goal is "a non-lawyer can read this in 2 minutes
// without raising questions."
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Recepta" },
      {
        name: "description",
        content:
          "A short, plain-language summary of what Recepta collects, how it is used, and how long it is kept.",
      },
      { property: "og:title", content: "Privacy Policy — Recepta" },
      {
        property: "og:description",
        content: "Plain-language explanation of what we collect and how we use it.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-warm">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
              <Sparkles className="size-5" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">
              Recepta
            </span>
          </Link>
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <Badge />
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight md:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated: 18 August 2026
        </p>

        <Summary />

        <Section title="What we collect">
          <ul className="ml-6 list-disc space-y-2">
            <li>
              <strong>Your account details</strong> — name, email, phone
              number, salon name, city, and a hashed password.
            </li>
            <li>
              <strong>Your service catalog</strong> — service names, prices,
              and durations that you add in the dashboard.
            </li>
            <li>
              <strong>Customer chat messages</strong> — WhatsApp messages
              exchanged between your customers and the AI receptionist,
              including phone number and message text. If a customer sends
              a voice note, the AI transcribes it to text.
            </li>
            <li>
              <strong>Booking records</strong> — appointment time, service
              booked, customer name.
            </li>
            <li>
              <strong>Payment receipts</strong> — the transaction reference
              and screenshot you upload when paying a subscription invoice.
              We do not collect card numbers or bank passwords.
            </li>
            <li>
              <strong>Basic page-view analytics</strong> — counts of which
              pages are visited, with no personal data attached.
            </li>
          </ul>
        </Section>

        <Section title="How we use it">
          <p>We use the data above to:</p>
          <ul className="ml-6 list-disc space-y-2">
            <li>Run the AI receptionist on your behalf.</li>
            <li>Book, reschedule, and cancel appointments your customers request.</li>
            <li>Send service messages to your customers.</li>
            <li>Send you operational emails (receipts, account alerts, trial-expiry warnings).</li>
            <li>Improve the AI's replies.</li>
          </ul>
          <p className="mt-3">
            We do not sell, rent, or trade your data or your customers'
            data with third parties for marketing.
          </p>
        </Section>

        <Section title="AI and your data">
          <p>
            Chat messages and customer phone numbers are never used to
            train any third-party AI model. When the AI generates a
            reply, it sends only the current message and the recent
            conversation history to the model. The reply is generated and
            returned, and the provider retains it according to its own
            short retention policy.
          </p>
        </Section>

        <Section title="Who else sees it">
          <p>We share the minimum needed with the following service providers:</p>
          <ul className="ml-6 list-disc space-y-2">
            <li>
              <strong>Supabase</strong> — database hosting for salon, customer,
              booking, and message data.
            </li>
            <li>
              <strong>Meta (WhatsApp)</strong> — delivers chat messages to
              and from your customers.
            </li>
            <li>
              <strong>Our LLM provider</strong> — processes the current
              message to generate the AI reply.
            </li>
            <li>
              <strong>Our voice-transcription provider</strong> — converts
              voice notes into text. Audio is deleted after transcription.
            </li>
            <li>
              <strong>Plausible Analytics</strong> — counts page views in a
              privacy-friendly way. No cookies, no personal data.
            </li>
          </ul>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep your data while your account is active. When you
            cancel or close your account, we permanently delete your
            salon's chat transcripts, booking records, customer contact
            details, and uploaded payment screenshots within{" "}
            <strong>90 days</strong>. Aggregated, non-identifying
            analytics (for example, "this salon received 200 messages
            last month") may be retained for product research.
          </p>
        </Section>

        <Section title="Your choices">
          <p>You and your customers can:</p>
          <ul className="ml-6 list-disc space-y-2">
            <li>Ask for a copy of the data we hold.</li>
            <li>Ask us to correct inaccurate data.</li>
            <li>Ask us to delete your data, subject to the retention window above.</li>
            <li>Withdraw consent for any optional processing.</li>
          </ul>
          <p className="mt-3">
            To exercise any of these, email{" "}
            <a
              href="mailto:hello@recepta.pk"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              hello@recepta.pk
            </a>
            . We respond within 30 days.
          </p>
        </Section>

        <Section title="Security">
          <p>
            We use TLS in transit, encrypted database storage, and
            role-based access control. No method of transmission over
            the internet is 100% secure, but we follow standard
            practices.
          </p>
        </Section>

        <Section title="Children's data">
          <p>
            Recepta is for adult business owners. We do not knowingly
            collect data from children under 18. If you believe a child
            has used the service, email us and we will delete the
            relevant data.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this page from time to time. When we do, we
            will revise the date at the top. If the change is
            significant, we will email active salon owners before it
            takes effect.
          </p>
        </Section>

        <Contact />
      </main>
    </div>
  );
}

function Badge() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
      <ShieldCheck className="size-3.5" />
      Privacy &amp; data handling
    </div>
  );
}

function Summary() {
  return (
    <div className="mt-8 rounded-3xl border border-border/70 bg-card p-6 shadow-luxe md:p-8">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        In short
      </h2>
      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
        <li>✓ We store the minimum data needed to run the service.</li>
        <li>✓ We never sell or rent your data or your customers' data.</li>
        <li>✓ When you cancel, we delete your chat and booking data within 90 days.</li>
        <li>✓ Chat messages are never used to train any third-party AI model.</li>
        <li>✓ We use 5 named service providers — all listed below.</li>
      </ul>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground [&_em]:text-foreground [&_a]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function Contact() {
  return (
    <div className="mt-12 rounded-3xl border border-accent/30 bg-accent/5 p-6 md:p-8">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        Questions?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Email us at{" "}
        <a
          href="mailto:hello@recepta.pk"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          hello@recepta.pk
        </a>{" "}
        — we read every message and respond within 24 hours.
      </p>
      <Button asChild className="mt-4">
        <a href="mailto:hello@recepta.pk">
          <Mail className="mr-2 size-4" />
          Email hello@recepta.pk
        </a>
      </Button>
    </div>
  );
}
