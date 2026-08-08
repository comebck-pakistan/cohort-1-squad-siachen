import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Check,
  Store,
  Scissors,
  Upload,
  Lock,
  Mail,
  Phone,
  PartyPopper,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { api } from "@/lib/api";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Get started — Recepta Onboarding" },
      {
        name: "description",
        content:
          "Set up your Recepta WhatsApp receptionist in under 5 minutes — salon profile, services, and free trial.",
      },
      { property: "og:title", content: "Onboarding — Recepta" },
      { property: "og:description", content: "Set up your Recepta AI receptionist on a free trial." },
    ],
  }),
  component: OnboardingPage,
});

// ---- Steps -----------------------------------------------------------------

const STEPS = [
  { key: "profile", title: "Salon Profile", icon: Store },
  { key: "services", title: "Services", icon: Scissors },
  { key: "account", title: "Create account", icon: Lock },
] as const;

type SalonType =
  | "Hair Salon"
  | "Nail Bar"
  | "MedSpa"
  | "Barbershop"
  | "Lash & Brow Studio";

const SALON_TYPES: SalonType[] = [
  "Hair Salon",
  "Nail Bar",
  "MedSpa",
  "Barbershop",
  "Lash & Brow Studio",
];

const CITIES = [
  "Karachi",
  "Lahore",
  "Islamabad",
  "Rawalpindi",
  "Multan",
  "Faisalabad",
  "Peshawar",
];

const CATEGORIES = ["Hair", "Skin", "Nails", "Other"] as const;

// ---- Service state types ----------------------------------------------------

interface ServiceDraft {
  /** Stable client-side id so React keys + edits work. */
  uid: string;
  name: string;
  /** Stored as string to match the existing dashboard UX; parsed on submit. */
  price: string;
  duration_minutes: string;
  category: string;
}

function emptyService(): ServiceDraft {
  return {
    uid:
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `svc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: "",
    price: "",
    duration_minutes: "",
    category: "Hair",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- Component --------------------------------------------------------------

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  // Step 1 — Salon Profile
  const [salonName, setSalonName] = useState("");
  const [salonType, setSalonType] = useState<SalonType | "">("");
  const [city, setCity] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  // Salon WhatsApp number — the line customers will message. Stored as
  // E.164-ish digits (e.g. "923001234567") so it matches the rest of the
  // codebase. The wizard lets the owner paste "+92 300 1234567" and we
  // strip the formatting before sending.
  const [whatsappNumber, setWhatsappNumber] = useState("");

  // Step 2 — Services
  const [services, setServices] = useState<ServiceDraft[]>([emptyService()]);

  // Step 3 — Create account
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // ---- Validation helpers --------------------------------------------------

  // Strip spaces, dashes, parens, plus signs. Leaves only digits. Then
  // require 10-15 digits — covers PTCL (10), mobiles (12 with country code),
  // and the international ceiling.
  const normalizeWhatsApp = (raw: string): string =>
    raw.replace(/[\s\-()+]/g, "").replace(/^0+/, "");

  const step1Valid = useMemo(
    () =>
      salonName.trim().length >= 2 &&
      salonType !== "" &&
      city !== "" &&
      EMAIL_RE.test(ownerEmail.trim()) &&
      (() => {
        const digits = normalizeWhatsApp(whatsappNumber);
        return digits.length >= 10 && digits.length <= 15 && /^\d+$/.test(digits);
      })(),
    [salonName, salonType, city, ownerEmail, whatsappNumber],
  );

  const step2Valid = useMemo(() => {
    if (services.length < 1) return false;
    return services.every((s) => {
      const duration = Number(s.duration_minutes);
      return (
        s.name.trim().length >= 1 &&
        Number.isInteger(duration) &&
        duration >= 5 &&
        (s.price === "" || Number(s.price) >= 0)
      );
    });
  }, [services]);

  const step3Valid =
    password.length >= 8 && confirmPassword === password && password === confirmPassword;

  // ---- Submit ---------------------------------------------------------------

  const signupMut = useMutation({
    mutationFn: () => {
      const payload = {
        salonName: salonName.trim(),
        salonType: salonType as SalonType,
        city,
        email: ownerEmail.trim(),
        password,
        whatsappNumber: normalizeWhatsApp(whatsappNumber),
        services: services.map((s) => ({
          name: s.name.trim(),
          duration_minutes: Number(s.duration_minutes),
          price: s.price === "" ? undefined : Number(s.price),
          category: s.category,
        })),
      };
      return api.freeTrialSignup(payload);
    },
    onSuccess: () => {
      // Redirect to /login with a flash message. The login page reads
      // `?from=signup` and toasts a welcome message.
      void navigate({ to: "/login", search: { from: "signup" } });
    },
    onError: (err: Error) => {
      const raw = err.message || "";
      if (/409|EMAIL_TAKEN|already/i.test(raw)) {
        toast.error(
          "This email is already registered. Try logging in instead.",
          {
            action: {
              label: "Log in",
              onClick: () => void navigate({ to: "/login" }),
            },
          },
        );
      } else if (/400|VALIDATION/i.test(raw)) {
        toast.error("Please double-check the form fields and try again.");
      } else {
        toast.error(raw || "Could not create your salon. Please try again.");
      }
    },
  });

  // ---- Navigation ----------------------------------------------------------

  function next() {
    if (step === 0 && !step1Valid) {
      toast.error("Please complete every field on the salon profile.");
      return;
    }
    if (step === 1 && !step2Valid) {
      toast.error(
        "Add at least one service with a name and a duration of 5 minutes or more.",
      );
      return;
    }
    if (step < STEPS.length - 1) setStep(step + 1);
  }

  function back() {
    if (step > 0) setStep(step - 1);
  }

  function finish() {
    if (!step3Valid) {
      if (password.length < 8) {
        toast.error("Password must be at least 8 characters.");
      } else if (password !== confirmPassword) {
        toast.error("Passwords do not match.");
      }
      return;
    }
    signupMut.mutate();
  }

  // ---- Service-row helpers -------------------------------------------------

  function updateService(uid: string, patch: Partial<ServiceDraft>) {
    setServices((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
    );
  }
  function removeService(uid: string) {
    setServices((prev) =>
      prev.length > 1 ? prev.filter((s) => s.uid !== uid) : prev,
    );
  }
  function addService() {
    setServices((prev) => [...prev, emptyService()]);
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-warm">
      <header className="border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
              <Sparkles className="size-5" />
            </div>
            <div className="font-display text-lg font-semibold">Recepta</div>
          </Link>
          <div className="text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-6 pb-4">
          <Progress value={progress} className="h-1.5" />
          <div className="mt-3 flex justify-between gap-2 text-[11px] font-medium uppercase tracking-widest">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  className={cn(
                    "flex items-center gap-1.5",
                    i === step
                      ? "text-primary"
                      : i < step
                        ? "text-foreground/60"
                        : "text-muted-foreground/50",
                  )}
                >
                  <div
                    className={cn(
                      "grid size-5 place-items-center rounded-full text-[10px]",
                      i < step
                        ? "bg-primary text-primary-foreground"
                        : i === step
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {i < step ? <Check className="size-3" /> : <Icon className="size-3" />}
                  </div>
                  <span className="hidden sm:inline">{s.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-3xl border border-border/70 bg-card p-8 shadow-luxe md:p-10">
          {step === 0 && (
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight">
                Tell us about your salon
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                The bot uses this to greet your customers and quote hours correctly.
              </p>

              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label htmlFor="salon-name">Salon Name</Label>
                  <Input
                    id="salon-name"
                    className="mt-1.5 h-11"
                    placeholder="e.g. Aura Salon & Spa"
                    value={salonName}
                    onChange={(e) => setSalonName(e.target.value)}
                    autoComplete="organization"
                  />
                </div>

                <div>
                  <Label htmlFor="city">City</Label>
                  <Select value={city} onValueChange={setCity}>
                    <SelectTrigger id="city" className="mt-1.5 h-11">
                      <SelectValue placeholder="Select city" />
                    </SelectTrigger>
                    <SelectContent>
                      {CITIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="email">Owner Email</Label>
                  <div className="relative mt-1.5">
                    <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@salon.pk"
                      className="pl-10 h-11"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <Label htmlFor="whatsapp">Salon WhatsApp Number</Label>
                  <div className="relative mt-1.5">
                    <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="whatsapp"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="+92 300 1234567"
                      className="pl-10 h-11"
                      value={whatsappNumber}
                      onChange={(e) => setWhatsappNumber(e.target.value)}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The WhatsApp line customers will message. Pair it in the
                    next step.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <Label>Salon Type</Label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {SALON_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSalonType(t)}
                        className={cn(
                          "rounded-xl border px-3 py-3 text-sm text-left transition-all",
                          salonType === t
                            ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/40"
                            : "border-border/70 hover:border-primary/40",
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-3xl font-semibold tracking-tight">
                    Add your services
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    The bot uses these to answer booking questions. You can edit them later
                    from the dashboard.
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 gap-1.5">
                  {services.length} added
                </Badge>
              </div>

              <div className="mt-8 space-y-4">
                {services.map((s, i) => (
                  <div
                    key={s.uid}
                    className="rounded-2xl border border-border/70 bg-muted/20 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Service {i + 1}
                      </div>
                      {services.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeService(s.uid)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_120px_120px_140px]">
                      <div>
                        <Label className="text-xs">Name</Label>
                        <Input
                          className="mt-1 h-10"
                          placeholder="e.g. Haircut & Style"
                          value={s.name}
                          onChange={(e) =>
                            updateService(s.uid, { name: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Price (Rs.)</Label>
                        <Input
                          className="mt-1 h-10"
                          type="number"
                          min={0}
                          placeholder="2000"
                          value={s.price}
                          onChange={(e) =>
                            updateService(s.uid, { price: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Duration (min)</Label>
                        <Input
                          className="mt-1 h-10"
                          type="number"
                          min={5}
                          step={5}
                          placeholder="45"
                          value={s.duration_minutes}
                          onChange={(e) =>
                            updateService(s.uid, { duration_minutes: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Category</Label>
                        <Select
                          value={s.category}
                          onValueChange={(v) => updateService(s.uid, { category: v })}
                        >
                          <SelectTrigger className="mt-1 h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  onClick={addService}
                  className="w-full rounded-2xl border-dashed"
                >
                  + Add another service
                </Button>
              </div>

              {/* OCR placeholder — UI shipped, backend parsing deferred to Phase 2. */}
              <div className="mt-6 flex items-center justify-between rounded-2xl border border-dashed border-border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Upload className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      Upload menu or price list
                    </div>
                    <div className="text-xs text-muted-foreground">
                      PDF or image · We'll auto-fill services for you
                    </div>
                  </div>
                </div>
                <Badge className="bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent">
                  Coming soon
                </Badge>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-gradient-luxe text-white shadow-luxe">
                <PartyPopper className="size-7" />
              </div>
              <h2 className="mt-4 text-center font-display text-3xl font-semibold tracking-tight">
                Create your account
              </h2>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Start your 7-day free trial — no payment required. You'll sign in with
                the password below.
              </p>

              <div className="mx-auto mt-8 max-w-md space-y-4">
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Salon</span>
                    <span className="font-semibold">{salonName || "—"}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-semibold">{ownerEmail || "—"}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Services</span>
                    <span className="font-semibold">{services.length}</span>
                  </div>
                </div>

                <div>
                  <Label htmlFor="password">Password</Label>
                  <div className="relative mt-1.5">
                    <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className="pl-10 pr-16 h-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div>
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <div className="relative mt-1.5">
                    <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Re-enter your password"
                      className="pl-10 h-11"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                  {password.length > 0 && confirmPassword.length > 0 && password !== confirmPassword && (
                    <p className="mt-1 text-xs text-destructive">
                      Passwords do not match.
                    </p>
                  )}
                </div>

                <Button
                  type="button"
                  onClick={finish}
                  disabled={!step3Valid || signupMut.isPending}
                  className="h-12 w-full rounded-full bg-gradient-luxe text-white shadow-luxe hover:opacity-95"
                >
                  {signupMut.isPending ? (
                    "Creating your salon…"
                  ) : (
                    <>
                      Start for Free <Sparkles className="size-4" />
                    </>
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  By continuing you agree to our terms. You can cancel anytime during
                  the trial — no card needed.
                </p>
              </div>
            </div>
          )}

          {step !== 2 && (
            <div className="mt-10 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={back}
                disabled={step === 0}
                className="rounded-full"
              >
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Button
                type="button"
                onClick={next}
                disabled={(step === 0 && !step1Valid) || (step === 1 && !step2Valid)}
                className="h-11 rounded-full bg-gradient-luxe px-6 text-white shadow-luxe hover:opacity-95"
              >
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="mt-8 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={back}
                disabled={signupMut.isPending}
                className="rounded-full"
              >
                <ArrowLeft className="size-4" /> Back
              </Button>
              <span className="text-xs text-muted-foreground">
                Need help? hello@recepta.pk
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
