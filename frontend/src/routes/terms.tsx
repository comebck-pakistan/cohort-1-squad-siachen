import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, FileText, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// /terms — Terms of Service (Wave 17: production-readiness pass).
//
// Short, plain-language, MVP. No statute references, no defined legal
// terms, no carve-outs, no consumer-protection sections. Just the
// basics: what the service is, how billing works, what's a fair-use
// refund, what we ask of you, and how to reach us. The goal is "a
// non-lawyer can read this in 2 minutes without raising questions."
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Recepta" },
      {
        name: "description",
        content:
          "A short, plain-language summary of how Recepta works, how billing works, and what's expected of you.",
      },
      { property: "og:title", content: "Terms of Service — Recepta" },
      {
        property: "og:description",
        content: "The agreement between you and Recepta when you sign up.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated: 18 August 2026
        </p>

        <Section title="The agreement">
          <p>
            These Terms are the agreement between you (the salon owner)
            and Squad Siachen Cohort 1 Comebck Pakistan, the operator of
            Recepta. By creating an account or using the service, you
            agree to these Terms and to our{" "}
            <Link to="/privacy" className="font-medium text-foreground underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            . If you do not agree, do not use the service.
          </p>
        </Section>

        <Section title="What Recepta is">
          <p>
            Recepta is a software service that connects your salon's
            WhatsApp Business number to an AI receptionist. The agent can
            answer customer questions, list your services, and book,
            reschedule, or cancel appointments. We do not provide a
            phone number, take payment from your customers, or employ
            the agent — those flows are between you and your customers.
          </p>
        </Section>

        <Section title="Plans and billing">
          <p>
            We offer subscription plans (currently Basic and Pro) listed
            on our{" "}
            <Link to="/" className="font-medium text-foreground underline-offset-4 hover:underline">
              homepage
            </Link>
            . Prices are in Pakistani Rupees (PKR) and may be subject to
            additional taxes or transaction fees charged by your bank or
            mobile wallet.
          </p>
          <p>
            <strong>Manual billing — no auto-renew, no auto-charge.</strong>{" "}
            When your current subscription period ends, the agent
            pauses. To resume, you submit a new payment via the{" "}
            <Link to="/payment" search={{ plan: "pro" }} className="font-medium text-foreground underline-offset-4 hover:underline">
              /payment
            </Link>{" "}
            page and we manually approve the receipt. We do not store
            your card or bank details, and we will never charge you
            without an explicit payment submission.
          </p>
        </Section>

        <Section title="Free trial">
          <p>
            New accounts get a 7-day free trial. During the trial you
            can use the Basic plan features at no cost. We may extend
            a trial for individual accounts at our discretion.
          </p>
        </Section>

        <Section title="Refunds">
          <p>
            We do not offer refunds for change-of-mind or unused
            subscription time. If something specific is broken with
            the service — for example, the agent can't send or receive
            WhatsApp messages on your salon's number, or the booking
            system consistently fails to create appointments — email{" "}
            <a
              href="mailto:hello@recepta.pk"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              hello@recepta.pk
            </a>{" "}
            and we will work to fix it. If we cannot resolve the issue
            to your reasonable satisfaction within 14 days, we will
            refund the unused portion of your current paid period.
          </p>
        </Section>

        <Section title="What we ask of you">
          <ul className="ml-6 list-disc space-y-2">
            <li>Keep your salon information and service catalog accurate.</li>
            <li>Follow WhatsApp's Commerce and Business Messaging rules.</li>
            <li>Do not use the service for spam, scams, or anything illegal.</li>
            <li>Keep your account credentials secure.</li>
            <li>Do not reverse-engineer, resell, or white-label the platform without our written permission.</li>
          </ul>
        </Section>

        <Section title="Service availability">
          <p>
            We aim to keep the service available 24/7. From time to
            time we may need to perform maintenance, during which the
            service may be briefly unavailable. We do not guarantee
            100% uptime and we are not responsible for downtime caused
            by Meta's WhatsApp platform, your internet service
            provider, or events outside our control.
          </p>
        </Section>

        <Section title="Suspension and termination">
          <p>
            We may suspend or terminate your account if you breach
            these Terms, fail to pay an outstanding invoice, or use
            the service in a way that creates a security or legal
            risk. We will give you reasonable notice where possible.
            You may terminate at any time by emailing us.
          </p>
        </Section>

        <Section title="Our liability">
          <p>
            To the extent the law allows, our total liability to you for
            any claim related to the service is limited to the amount
            you paid us in the 12 months before the claim. We are not
            liable for indirect or consequential damages, such as lost
            profits or business interruption. We do not exclude
            liability for anything that cannot be excluded by law.
          </p>
        </Section>

        <Section title="Your responsibility">
          <p>
            You are responsible for what you do with the service —
            including your service catalog, your customer
            communications, and what your customers send you. If a
            third party (a customer, Meta, or any authority) makes a
            claim arising from your use of the service, you agree to
            cover us. This does not apply to claims that arise from our
            own wrongdoing.
          </p>
        </Section>

        <Section title="Your data">
          <p>
            Your salon data, customer conversations, and service catalog
            remain yours. See our{" "}
            <Link to="/privacy" className="font-medium text-foreground underline-offset-4 hover:underline">
              Privacy Policy
            </Link>{" "}
            for how we handle it.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update these Terms from time to time. When we do, we
            will revise the date at the top. If the change is
            significant, we will email active salon owners at least 14
            days before it takes effect.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these Terms? Email{" "}
            <a
              href="mailto:hello@recepta.pk"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              hello@recepta.pk
            </a>
            . We read every message and respond within 24 hours.
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
      <FileText className="size-3.5" />
      The agreement
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
        Need to get in touch?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Email us at{" "}
        <a
          href="mailto:hello@recepta.pk"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          hello@recepta.pk
        </a>{" "}
        — we respond within 24 hours.
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
