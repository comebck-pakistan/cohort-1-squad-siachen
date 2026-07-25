import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Check,
  Store,
  Bot,
  Link2,
  ClipboardList,
  Trash2,
  Plus,
  CreditCard,
  Upload,
  Smartphone,
  Landmark,
  PartyPopper,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type TierKey = "single" | "boutique" | "luxury";
type Billing = "monthly" | "annual";

interface OnboardingSearch {
  tier?: TierKey;
  billing?: Billing;
}

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => {
    const tier = search.tier;
    const billing = search.billing;
    return {
      tier: tier === "single" || tier === "boutique" || tier === "luxury" ? tier : undefined,
      billing: billing === "annual" || billing === "monthly" ? billing : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Get started — Recepta Onboarding" },
      {
        name: "description",
        content:
          "Set up your Recepta WhatsApp receptionist — salon profile, agent persona, booking software, services and payment.",
      },
      { property: "og:title", content: "Onboarding — Recepta" },
      { property: "og:description", content: "Set up your Recepta AI receptionist in under 10 minutes." },
    ],
  }),
  component: OnboardingPage,
});

const STEPS = [
  { key: "profile", title: "Salon Profile", icon: Store },
  { key: "persona", title: "WhatsApp Agent & Persona", icon: Bot },
  { key: "software", title: "Booking Software", icon: Link2 },
  { key: "knowledge", title: "Services & Pricing", icon: ClipboardList },
  { key: "payment", title: "Payment", icon: CreditCard },
] as const;

type SalonType = "Hair Salon" | "Nail Bar" | "MedSpa" | "Barbershop" | "Lash & Brow Studio";
type Tone = "warm" | "sleek" | "upbeat";

interface Service {
  id: string;
  name: string;
  price: string;
}

const TIERS: Record<TierKey, { name: string; monthly: number }> = {
  single: { name: "Single Chair / Solo", monthly: 5000 },
  boutique: { name: "Boutique Salon", monthly: 12000 },
  luxury: { name: "Luxury / Multi-Branch", monthly: 25000 },
};

const JAZZCASH_NUMBER = "+92 300 1234567";
const JAZZCASH_NAME = "Recepta Technologies";
const BANK_NAME = "Meezan Bank";
const BANK_ACCOUNT_TITLE = "Recepta Technologies (Pvt) Ltd";
const BANK_ACCOUNT_NUMBER = "0123-4567-8901-2345";
const BANK_IBAN = "PK36 MEZN 0001 2345 6789 0123";

function OnboardingPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Step 1
  const [salonName, setSalonName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [salonType, setSalonType] = useState<SalonType | "">("");

  // Step 2
  const [agentName, setAgentName] = useState("Bella");
  const [tone, setTone] = useState<Tone>("warm");
  const [languages, setLanguages] = useState<Record<"en" | "ur" | "roman", boolean>>({
    en: true,
    ur: true,
    roman: true,
  });

  // Step 3
  const [software, setSoftware] = useState<string>("");

  // Step 4
  const [services, setServices] = useState<Service[]>([
    { id: crypto.randomUUID(), name: "Women's Haircut", price: "3,500" },
    { id: crypto.randomUUID(), name: "Full Gel Manicure", price: "2,800" },
  ]);
  const [deposit, setDeposit] = useState(true);

  // Step 5 — payment
  const [tier, setTier] = useState<TierKey>(search.tier ?? "boutique");
  const [billing, setBilling] = useState<Billing>(search.billing ?? "monthly");
  const [payMethod, setPayMethod] = useState<"jazzcash" | "bank">("jazzcash");
  const [payerName, setPayerName] = useState("");
  const [txnRef, setTxnRef] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);

  const progress = ((step + 1) / STEPS.length) * 100;

  const currentPrice =
    billing === "annual"
      ? Math.round(TIERS[tier].monthly * 10)
      : TIERS[tier].monthly;

  function next() {
    if (step === 0 && (!salonName || !phone || !city || !salonType)) {
      toast.error("Please complete your salon profile");
      return;
    }
    if (step < STEPS.length - 1) setStep(step + 1);
  }
  function back() {
    if (step > 0) setStep(step - 1);
  }

  async function finish() {
    if (!payerName.trim()) {
      toast.error("Please enter the name used for the payment");
      return;
    }
    if (!receipt) {
      toast.error("Please attach the payment screenshot for confirmation");
      return;
    }
    setSubmitting(true);
    localStorage.setItem(
      "recepta.onboarding",
      JSON.stringify({
        salonName,
        phone,
        city,
        salonType,
        agentName,
        tone,
        languages,
        software,
        services,
        deposit,
        tier,
        billing,
        payMethod,
        payerName,
        txnRef,
        receiptName: receipt.name,
      }),
    );
    await new Promise((r) => setTimeout(r, 900));
    setSubmitting(false);
    setDone(true);
  }

  if (done) {
    return <SuccessScreen salonName={salonName} agentName={agentName} onHome={() => navigate({ to: "/" })} />;
  }

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
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                className={cn(
                  "flex items-center gap-1.5",
                  i === step ? "text-primary" : i < step ? "text-foreground/60" : "text-muted-foreground/50",
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
                  {i < step ? <Check className="size-3" /> : i + 1}
                </div>
                <span className="hidden sm:inline">{s.title}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-3xl border border-border/70 bg-card p-8 shadow-luxe md:p-10">
          {step === 0 && (
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight">Tell us about your salon</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We'll use this to configure your AI receptionist's greeting.
              </p>
              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label>Salon Name</Label>
                  <Input
                    className="mt-1.5 h-11"
                    placeholder="e.g. Aura Salon & Spa"
                    value={salonName}
                    onChange={(e) => setSalonName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Phone Number</Label>
                  <Input
                    className="mt-1.5 h-11"
                    placeholder="+92 300 1234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <Label>City</Label>
                  <Select value={city} onValueChange={setCity}>
                    <SelectTrigger className="mt-1.5 h-11">
                      <SelectValue placeholder="Select city" />
                    </SelectTrigger>
                    <SelectContent>
                      {["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Multan", "Faisalabad", "Peshawar"].map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>Salon Type</Label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {(["Hair Salon", "Nail Bar", "MedSpa", "Barbershop", "Lash & Brow Studio"] as SalonType[]).map((t) => (
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
              <h2 className="font-display text-3xl font-semibold tracking-tight">Configure your WhatsApp receptionist</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Give your agent a name, pick the tone, and select the WhatsApp languages she replies in.
              </p>

              <div className="mt-8 space-y-6">
                <div>
                  <Label>AI Agent Name</Label>
                  <Input
                    className="mt-1.5 h-11"
                    placeholder="Bella, Chloe, Aisha…"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Tone & Style</Label>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {[
                      { key: "warm" as const, title: "Warm & Friendly", desc: "Approachable, familiar, uses first names" },
                      { key: "sleek" as const, title: "Sleek & Professional", desc: "Polished, concise, luxury-brand cadence" },
                      { key: "upbeat" as const, title: "Upbeat & Trendy", desc: "Playful, emoji-friendly, Gen-Z ready" },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setTone(opt.key)}
                        className={cn(
                          "rounded-2xl border p-4 text-left transition-all",
                          tone === opt.key
                            ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                            : "border-border/70 hover:border-primary/40",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold">{opt.title}</div>
                          {tone === opt.key && <Check className="size-4 text-primary" />}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
                  <div className="text-sm font-semibold">WhatsApp languages</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose which languages {agentName || "your agent"} will read and reply in on WhatsApp.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {[
                      { key: "en" as const, title: "English", desc: "Latin script" },
                      { key: "ur" as const, title: "اردو", desc: "Nastaliq / Arabic script" },
                      { key: "roman" as const, title: "Roman Urdu", desc: "e.g. 'appointment chahiye'" },
                    ].map((l) => {
                      const active = languages[l.key];
                      return (
                        <button
                          key={l.key}
                          type="button"
                          onClick={() => setLanguages((prev) => ({ ...prev, [l.key]: !prev[l.key] }))}
                          className={cn(
                            "rounded-xl border p-3 text-left transition-all",
                            active
                              ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                              : "border-border/70 hover:border-primary/40",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold">{l.title}</div>
                            {active && <Check className="size-4 text-primary" />}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{l.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight">Connect your booking software</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Recepta will sync appointments both ways. Skip if you don't use one yet.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  { key: "square", name: "Square Appointments", desc: "Most popular in Pakistan" },
                  { key: "boulevard", name: "Boulevard", desc: "Luxury spa & medspa" },
                  { key: "fresha", name: "Fresha", desc: "Free salon booking software" },
                  { key: "mindbody", name: "Mindbody", desc: "Enterprise wellness" },
                  { key: "gcal", name: "Google Calendar", desc: "Simple 2-way sync" },
                  { key: "none", name: "None / Just Recepta", desc: "Use our built-in calendar" },
                ].map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSoftware(s.key)}
                    className={cn(
                      "flex items-center justify-between rounded-2xl border p-4 text-left transition-all",
                      software === s.key
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border/70 hover:border-primary/40",
                    )}
                  >
                    <div>
                      <div className="text-sm font-semibold">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.desc}</div>
                    </div>
                    {software === s.key ? (
                      <Check className="size-5 text-primary" />
                    ) : (
                      <div className="size-5 rounded-full border-2 border-border" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight">Top services & prices</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We'll train the AI on your most-requested services. You can edit anytime.
              </p>
              <div className="mt-6 space-y-3">
                {services.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Input
                      placeholder="Service name (e.g. HydraFacial)"
                      value={s.name}
                      onChange={(e) => {
                        const c = [...services];
                        c[i] = { ...c[i], name: e.target.value };
                        setServices(c);
                      }}
                      className="h-11 flex-1"
                    />
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                        Rs.
                      </span>
                      <Input
                        placeholder="3,500"
                        value={s.price}
                        onChange={(e) => {
                          const c = [...services];
                          c[i] = { ...c[i], price: e.target.value };
                          setServices(c);
                        }}
                        className="h-11 w-32 pl-10"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setServices(services.filter((x) => x.id !== s.id))}
                      className="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                      aria-label="Remove"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setServices([...services, { id: crypto.randomUUID(), name: "", price: "" }])
                  }
                  className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary"
                >
                  <Plus className="size-4" /> Add another service
                </button>
              </div>
              <div className="mt-8 flex items-center justify-between rounded-2xl border border-border/70 bg-muted/40 p-4">
                <div>
                  <div className="text-sm font-semibold">Collect deposit for high-value services?</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Automatically ask for a 25% deposit on services above Rs. 8,000.
                  </p>
                </div>
                <Switch checked={deposit} onCheckedChange={setDeposit} />
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight">Confirm your plan & payment</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Pick your plan, transfer the amount, and attach your payment screenshot for verification.
              </p>

              {/* Tier selection */}
              <div className="mt-8">
                <Label>Your plan</Label>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(Object.keys(TIERS) as TierKey[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTier(k)}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition-all",
                        tier === k
                          ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                          : "border-border/70 hover:border-primary/40",
                      )}
                    >
                      <div className="text-xs uppercase tracking-widest text-muted-foreground">{k}</div>
                      <div className="mt-1 text-sm font-semibold">{TIERS[k].name}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Rs. {TIERS[k].monthly.toLocaleString("en-PK")}/mo
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 inline-flex items-center gap-3 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setBilling("monthly")}
                    className={cn(
                      "rounded-full px-3 py-1",
                      billing === "monthly" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setBilling("annual")}
                    className={cn(
                      "rounded-full px-3 py-1",
                      billing === "annual" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    Annual · Save 17%
                  </button>
                </div>
              </div>

              {/* Amount due */}
              <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-5">
                <div className="text-xs uppercase tracking-widest text-primary">Amount due today</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold text-muted-foreground">Rs.</span>
                  <span className="font-display text-4xl font-semibold tracking-tight">
                    {currentPrice.toLocaleString("en-PK")}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    /{billing === "annual" ? "year" : "month"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {TIERS[tier].name} plan · billed {billing}.
                </p>
              </div>

              {/* Payment method */}
              <div className="mt-6">
                <Label>How would you like to pay?</Label>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod("jazzcash")}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition-all",
                      payMethod === "jazzcash"
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border/70 hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Smartphone className="size-4 text-primary" />
                      <span className="text-sm font-semibold">JazzCash</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Mobile wallet transfer</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod("bank")}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition-all",
                      payMethod === "bank"
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border/70 hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Landmark className="size-4 text-primary" />
                      <span className="text-sm font-semibold">Bank transfer</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">IBFT / online banking</p>
                  </button>
                </div>

                <div className="mt-4 rounded-2xl border border-border/70 bg-muted/30 p-5">
                  {payMethod === "jazzcash" ? (
                    <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
                      <dt className="text-muted-foreground">JazzCash Number</dt>
                      <dd className="font-semibold tracking-wide">{JAZZCASH_NUMBER}</dd>
                      <dt className="text-muted-foreground">Account Title</dt>
                      <dd className="font-semibold">{JAZZCASH_NAME}</dd>
                    </dl>
                  ) : (
                    <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
                      <dt className="text-muted-foreground">Bank</dt>
                      <dd className="font-semibold">{BANK_NAME}</dd>
                      <dt className="text-muted-foreground">Account Title</dt>
                      <dd className="font-semibold">{BANK_ACCOUNT_TITLE}</dd>
                      <dt className="text-muted-foreground">Account #</dt>
                      <dd className="font-semibold tracking-wide">{BANK_ACCOUNT_NUMBER}</dd>
                      <dt className="text-muted-foreground">IBAN</dt>
                      <dd className="font-semibold tracking-wide">{BANK_IBAN}</dd>
                    </dl>
                  )}
                </div>
              </div>

              {/* Confirmation details */}
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Name used for payment</Label>
                  <Input
                    className="mt-1.5 h-11"
                    placeholder="e.g. Marriyam Andeel"
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Transaction ID / Reference (optional)</Label>
                  <Input
                    className="mt-1.5 h-11"
                    placeholder="e.g. TXN-8827361"
                    value={txnRef}
                    onChange={(e) => setTxnRef(e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-5">
                <Label>Payment screenshot</Label>
                <label
                  htmlFor="receipt"
                  className={cn(
                    "mt-1.5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-all",
                    receipt
                      ? "border-primary/50 bg-primary/5"
                      : "border-border/70 hover:border-primary/40 hover:bg-muted/40",
                  )}
                >
                  <div className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                    <Upload className="size-5" />
                  </div>
                  {receipt ? (
                    <>
                      <div className="text-sm font-semibold">{receipt.name}</div>
                      <div className="text-xs text-muted-foreground">Click to replace</div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-semibold">Upload payment screenshot or picture</div>
                      <div className="text-xs text-muted-foreground">PNG, JPG up to 10MB</div>
                    </>
                  )}
                  <input
                    id="receipt"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
          )}

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
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={next}
                className="h-11 rounded-full bg-gradient-luxe px-6 text-white shadow-luxe hover:opacity-95"
              >
                Continue <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={finish}
                disabled={submitting}
                className="h-11 rounded-full bg-gradient-luxe px-6 text-white shadow-luxe hover:opacity-95"
              >
                {submitting ? "Submitting…" : "Submit for verification"} <Sparkles className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SuccessScreen({
  salonName,
  agentName,
  onHome,
}: {
  salonName: string;
  agentName: string;
  onHome: () => void;
}) {
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
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-3xl border border-border/70 bg-card p-10 text-center shadow-luxe">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-gradient-luxe text-white shadow-luxe">
            <PartyPopper className="size-8" />
          </div>
          <h2 className="mt-6 font-display text-3xl font-semibold tracking-tight md:text-4xl">
            All done{salonName ? `, ${salonName}` : ""}! 🎉
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">
            We've received your details and payment screenshot. Our team will verify your transfer
            and send your dashboard credentials to your WhatsApp and email{" "}
            <span className="font-semibold text-foreground">within one business day</span>.
          </p>
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-primary/30 bg-primary/5 p-5 text-left">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">
              What happens next
            </div>
            <ol className="mt-3 space-y-2 text-sm text-foreground/80">
              <li className="flex gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">1</span>
                We verify your payment (usually within a few hours).
              </li>
              <li className="flex gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">2</span>
                Our team provisions {agentName || "your agent"} in the Recepta dashboard.
              </li>
              <li className="flex gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">3</span>
                You receive your login credentials on WhatsApp & email.
              </li>
            </ol>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Wishing you a chair that's always full, and clients that always come back. From all of
            us at Recepta — welcome to the family. 💫
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button
              onClick={onHome}
              className="h-11 rounded-full bg-gradient-luxe px-6 text-white shadow-luxe hover:opacity-95"
            >
              Back to home
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-full">
              <a href="mailto:hello@recepta.pk">Contact our team</a>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
