import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// /waitlist — landing-page waitlist signup page.
//
// Lives at its own URL (instead of being inline in the hero) so the form
// gets full focus, proper page chrome, and room for the copy that explains
// why we're waitlist-only while in early access. The form posts to
// POST /api/waitlist (routes/waitlist.ts on the backend).
//
// All four contact fields are required so we can actually follow up;
// salon_type is optional but helps us tailor the manual onboarding call.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/waitlist")({
  head: () => ({
    meta: [
      { title: "Join the Recepta waitlist · early access" },
      {
        name: "description",
        content:
          "Get on the Recepta early-access waitlist. We're rolling out paid plans as we learn from real salons — leave your details and we'll reach out when your spot opens.",
      },
    ],
  }),
  component: WaitlistPage,
});

function WaitlistPage() {
  return (
    <div className="min-h-screen bg-gradient-warm">
      {/* Top nav — minimal, just brand + back link */}
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
            to="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <div className="mb-8 text-center">
          <Badge className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="mr-1 size-3" /> Early access
          </Badge>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Join the waitlist
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
            We're rolling out paid plans as we learn from real salons. Drop your
            details and we'll reach out when your spot opens — no spam, no
            newsletter, just a real conversation about your salon.
          </p>
        </div>

        <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-luxe md:p-8">
          <WaitlistForm />
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          Want to skip the queue?{" "}
          <Link
            to="/onboarding"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Start the 7-day free trial →
          </Link>
        </div>
      </main>
    </div>
  );
}

function WaitlistForm() {
  const [name, setName] = useState("");
  const [salonName, setSalonName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [salonType, setSalonType] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same normalization as the backend's free-trial-signup.ts:103 — strip
  // spaces, dashes, parens, and leading zeros so a curl/Postman caller
  // who pastes a formatted number still validates.
  function normalizePhone(raw: string): string {
    return raw.replace(/[\s\-()+]/g, "").replace(/^0+/, "");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.waitlistSignup({
        name: name.trim(),
        salonName: salonName.trim(),
        phone: normalizePhone(phone),
        email: email.trim(),
        salonType: salonType
          ? (salonType as
              | "Hair Salon"
              | "Nail Bar"
              | "MedSpa"
              | "Barbershop"
              | "Lash & Brow Studio")
          : undefined,
      });
      setDone(true);
      toast.success("You're on the list — we'll be in touch.");
    } catch (err) {
      setError(
        (err as Error).message || "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-6" />
        </div>
        <div className="mt-4 font-display text-2xl font-semibold">
          You're on the list
        </div>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          We'll email <strong className="text-foreground">{email}</strong> and
          message <strong className="text-foreground">{phone}</strong> when
          your spot is ready.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          In the meantime, the trial is yours if you'd like to skip the queue.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            className="rounded-full bg-gradient-luxe text-white shadow-luxe hover:opacity-95"
          >
            <Link to="/onboarding">Start the 7-day trial</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="rounded-full"
          >
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Your name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ayesha Khan"
            required
            autoComplete="name"
            className="h-11 rounded-md bg-background"
          />
        </Field>
        <Field label="Salon name" required>
          <Input
            value={salonName}
            onChange={(e) => setSalonName(e.target.value)}
            placeholder="e.g. Aura Salon & Spa"
            required
            autoComplete="organization"
            className="h-11 rounded-md bg-background"
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="WhatsApp number" required hint="With country code, e.g. 923001234567">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="923001234567"
            type="tel"
            inputMode="numeric"
            required
            autoComplete="tel"
            className="h-11 rounded-md bg-background"
          />
        </Field>
        <Field label="Email" required>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@salon.pk"
            type="email"
            required
            autoComplete="email"
            className="h-11 rounded-md bg-background"
          />
        </Field>
      </div>
      <Field label="Salon type" optional>
        <select
          value={salonType}
          onChange={(e) => setSalonType(e.target.value)}
          className="h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Select your salon type (optional)</option>
          <option value="Hair Salon">Hair Salon</option>
          <option value="Nail Bar">Nail Bar</option>
          <option value="MedSpa">MedSpa</option>
          <option value="Barbershop">Barbershop</option>
          <option value="Lash & Brow Studio">Lash & Brow Studio</option>
        </select>
      </Field>
      <Button
        type="submit"
        disabled={submitting}
        size="lg"
        className="h-12 w-full rounded-full bg-gradient-luxe text-base text-white shadow-luxe hover:opacity-95 disabled:opacity-60"
      >
        {submitting ? "Joining…" : "Join the waitlist"}
        {!submitting && <Sparkles className="size-4" />}
      </Button>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        We'll only use your details to reach out about early access. No spam,
        no newsletter. You can ask us to delete your row at any time.
      </p>
    </form>
  );
}

function Field({
  label,
  required,
  optional,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium text-foreground/80">
        <span>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
          {optional && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              (optional)
            </span>
          )}
        </span>
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </label>
  );
}