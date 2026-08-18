import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Sparkles, Upload, Copy, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field-error";
import { api } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";
import {
  normalizePhone,
  validateEmail,
  validateNotEmpty,
  validatePhone,
  validatePhoneOptional,
} from "@/lib/formValidators";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// /payment — public payment page (Wave 13 + Wave 15).
//
// Reached from the landing-page pricing tier CTAs ("/payment?plan=basic" or
// "/payment?plan=pro") AND from the salon-portal Subscription tab (where the
// owner is already logged in).
//
// Two flows share the same UI shell:
//   1. Public — anonymous visitor fills name/email/phone by hand.
//   2. Logged-in salon owner — name + email are pre-filled from
//      `useTenantBusinessId` and rendered as read-only fields. The form
//      becomes a 3-field mini-form (phone/whatsapp optional, TID, screenshot)
//      and the submit handler also passes `businessId` so the resulting
//      payment_request is auto-attached to the salon's subscription.
//
// The merchant numbers are hardcoded for the MVP demo. Replace with real
// env-backed numbers before public launch.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/payment")({
  head: () => ({
    meta: [
      { title: "Subscribe to Recepta · pay via JazzCash / EasyPaisa" },
      {
        name: "description",
        content:
          "Pay for your Recepta plan via JazzCash, EasyPaisa, or bank transfer. Upload a screenshot and we'll activate your subscription within 24 hours.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    plan: typeof search.plan === "string" ? search.plan : "pro",
  }),
  component: PaymentPage,
});

function PaymentPage() {
  const { plan } = Route.useSearch();
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
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12 md:py-16">
        <div className="mb-8 text-center">
          <Badge className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="mr-1 size-3" />
            Activate your subscription
          </Badge>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Pay via JazzCash, EasyPaisa, or bank
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Send the amount to one of the numbers below, upload a screenshot
            of the receipt, and we'll activate your{" "}
            <span className="font-medium text-foreground">
              {plan === "basic" ? "Basic" : "Pro"}
            </span>{" "}
            subscription within 24 hours.
          </p>
        </div>

        <PaymentForm planId={plan} />
      </main>
    </div>
  );
}

function PaymentForm({ planId }: { planId: string }) {
  const navigate = useNavigate();
  const tenant = useTenantBusinessId();
  // Logged-in owner path: identity is non-null AND we have at least an
  // email. `userId` is also required so we never accidentally inherit
  // a half-loaded identity from a previous session.
  const owner = tenant.data;
  const isOwner = !!owner && !!owner.userId && !!owner.email;

  // Form state. When the owner is logged in, we pre-fill and lock
  // name+email; the inputs become a read-only "Paying as: …" card.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "jazzcash" | "easypaisa" | "bank_transfer"
  >("jazzcash");
  const [txnRef, setTxnRef] = useState("");
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [screenshotFilename, setScreenshotFilename] = useState<string | null>(null);
  const [screenshotMimeType, setScreenshotMimeType] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-field validation errors. We keep the submit button ALWAYS enabled
  // (only disabled while the request is in flight) so the user is never
  // confused by a button that refuses to do anything. On submit, we run
  // validate() — if anything is invalid, the first error gets focus and
  // the corresponding red message appears under the field.
  const [errors, setErrors] = useState<{
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
  }>({});

  // Seed the form from the owner's identity when it loads. Re-runs only
  // when the identity changes (e.g. logout/login in another tab clears
  // `owner` to null, then a fresh login re-seeds). We never overwrite a
  // field that already has a value — guards against the identity fetch
  // landing AFTER the user started typing in the public flow.
  useEffect(() => {
    if (!isOwner || !owner) return;
    setName((prev) => prev || owner.fullName || owner.email);
    setEmail((prev) => prev || owner.email);
  }, [isOwner, owner]);

  // Re-validate a single field as the user types — clears the error
  // the moment the value becomes valid. We don't show the error again
  // until the user has either blurred and re-touched, or hit submit.
  function liveValidateField(field: keyof typeof errors) {
    setErrors((prev) => {
      if (!prev[field]) return prev; // already null, no re-render
      const next = { ...prev };
      switch (field) {
        case "name":
          next.name = validateNotEmpty(name, "Full name");
          break;
        case "email":
          next.email = validateEmail(email);
          break;
        case "phone":
          next.phone = validatePhone(phone);
          break;
        case "whatsapp":
          next.whatsapp = validatePhoneOptional(whatsapp);
          break;
      }
      return next;
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setScreenshotBase64(null);
      setScreenshotFilename(null);
      setScreenshotMimeType(null);
      return;
    }
    if (file.size > 18 * 1024 * 1024) {
      setError("File exceeds 18MB limit");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:<mime>;base64," prefix
      const idx = result.indexOf(",");
      const base64 = idx >= 0 ? result.slice(idx + 1) : result;
      setScreenshotBase64(base64);
      setScreenshotMimeType(file.type);
      setScreenshotFilename(file.name);
      setError(null);
    };
    reader.onerror = () => setError("Could not read file");
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Run every validator. For logged-in owners we skip name/email since
    // those fields are read-only mirrors of the identity — they're
    // guaranteed correct.
    const nextErrors: typeof errors = isOwner
      ? {
          phone: validatePhone(phone),
          whatsapp: validatePhoneOptional(whatsapp),
        }
      : {
          name: validateNotEmpty(name, "Full name"),
          email: validateEmail(email),
          phone: validatePhone(phone),
          whatsapp: validatePhoneOptional(whatsapp),
        };
    setErrors(nextErrors);

    const firstInvalid = Object.values(nextErrors).find((v) => v);
    if (firstInvalid) {
      // Surface the error inline (form already shows red helper text).
      // No silent disabled button — the user immediately sees what to fix.
      toast.error(firstInvalid);
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.submitPaymentRequest({
        planId,
        paymentMethod,
        customerName: name.trim(),
        customerEmail: email.trim().toLowerCase(),
        customerPhone: normalizePhone(phone),
        customerWhatsapp: whatsapp.trim() ? normalizePhone(whatsapp) : null,
        transactionReference: txnRef.trim() || null,
        screenshotBase64,
        screenshotMimeType,
        screenshotFilename,
        // Auto-attach to the owner's salon so the superadmin doesn't have
        // to match an email → business by hand. Public visitors leave
        // this null and the backend creates an unattached row.
        businessId: isOwner ? owner.businessId : null,
      });
      toast.success("Payment submitted — we'll review shortly");
      void navigate({
        to: "/payment-success",
        search: { id: result.requestId, email: email.trim().toLowerCase() },
      });
    } catch (err) {
      const msg = (err as Error).message ?? "Submission failed";
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Left column: payment options */}
      <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-luxe md:p-8">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Send payment to
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick any of the three options. Use your salon's name as the
          transaction reference so we can match it faster.
        </p>

        <div className="mt-6 space-y-3">
          <PaymentOption
            label="JazzCash"
            value="jazzcash"
            selected={paymentMethod === "jazzcash"}
            onSelect={() => setPaymentMethod("jazzcash")}
            number="0300XXXXXXX"
            note="Account title: Vara Ali"
          />
          <PaymentOption
            label="EasyPaisa"
            value="easypaisa"
            selected={paymentMethod === "easypaisa"}
            onSelect={() => setPaymentMethod("easypaisa")}
            number="0300XXXXXXX"
            note="Account title: Vara Ali"
          />
          <PaymentOption
            label="Bank Transfer"
            value="bank_transfer"
            selected={paymentMethod === "bank_transfer"}
            onSelect={() => setPaymentMethod("bank_transfer")}
            number="Bank Alfalah · IBAN PK00XXXX0000000000000000"
            note="Account title: Vara Ali"
          />
        </div>

        <div className="mt-6 rounded-2xl border border-amber-200/60 bg-amber-50/60 p-4 text-sm text-amber-900">
          <strong>Heads up:</strong> these are placeholder numbers for the
          demo. Real merchant numbers will be wired in before public launch.
          For now, the demo flow will create the request and we'll match
          manually.
        </div>
      </div>

      {/* Right column: form */}
      <form
        onSubmit={onSubmit}
        className="rounded-3xl border border-border/70 bg-card p-6 shadow-luxe md:p-8"
      >
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Your details
        </h2>

        <div className="mt-6 space-y-4">
          {isOwner ? (
            // Logged-in owner — name/email are read-only. We render a
            // dedicated "Paying as" card so the owner sees the binding
            // (this is the salon the plan will activate on) and the
            // inputs feel intentional rather than missing.
            <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
              <div className="flex items-start gap-3">
                <Lock className="mt-0.5 size-4 text-accent-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Paying as
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold">
                    {owner.fullName || owner.email}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {owner.email}
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Plan will activate on{" "}
                    <span className="font-medium text-foreground">
                      {owner.businessName || "your salon"}
                    </span>{" "}
                    the moment we approve the receipt.
                  </div>
                </div>
              </div>
              {/* Hidden mirrors so the submit handler has the values
                  without polluting the visible UI. Required by the
                  backend `submitPaymentRequest` payload. */}
              <input type="hidden" value={name} readOnly />
              <input type="hidden" value={email} readOnly />
            </div>
          ) : (
            <>
              <Field label="Full name" required>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    liveValidateField("name");
                  }}
                  onBlur={() => liveValidateField("name")}
                  aria-invalid={!!errors.name}
                  placeholder="Ayesha Khan"
                />
                <FieldError error={errors.name} />
              </Field>

              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    liveValidateField("email");
                  }}
                  onBlur={() => liveValidateField("email")}
                  aria-invalid={!!errors.email}
                  placeholder="you@salon.com"
                />
                <FieldError error={errors.email} />
              </Field>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" required>
              <Input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  liveValidateField("phone");
                }}
                onBlur={() => liveValidateField("phone")}
                aria-invalid={!!errors.phone}
                placeholder="0300 1234567"
                inputMode="tel"
              />
              <FieldError error={errors.phone} />
            </Field>
            <Field label="WhatsApp (optional)">
              <Input
                value={whatsapp}
                onChange={(e) => {
                  setWhatsapp(e.target.value);
                  liveValidateField("whatsapp");
                }}
                onBlur={() => liveValidateField("whatsapp")}
                aria-invalid={!!errors.whatsapp}
                placeholder="0300 1234567"
                inputMode="tel"
              />
              <FieldError error={errors.whatsapp} />
            </Field>
          </div>

          <Field label="Transaction reference (TID)">
            <Input
              value={txnRef}
              onChange={(e) => setTxnRef(e.target.value)}
              placeholder="e.g. TX-1234567"
            />
          </Field>

          <Field label="Screenshot (optional)">
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-border bg-background/50 px-4 py-3 text-sm hover:bg-background">
              <Upload className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {screenshotFilename ? (
                  <span className="text-foreground">{screenshotFilename}</span>
                ) : (
                  "Click to upload JPG/PNG/HEIC (max 18MB)"
                )}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                onChange={onFile}
                className="hidden"
              />
            </label>
          </Field>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200/60 bg-red-50/70 p-3 text-sm text-red-900">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full"
          size="lg"
        >
          {submitting ? "Submitting..." : "Submit payment for review"}
        </Button>
      </form>
    </div>
  );
}

function PaymentOption({
  label,
  value,
  selected,
  onSelect,
  number,
  note,
}: {
  label: string;
  value: string;
  selected: boolean;
  onSelect: () => void;
  number: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-background/50 hover:bg-background"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {selected && <CheckCircle2 className="size-4 text-primary" />}
      </div>
      <div className="mt-2 flex items-center gap-2 font-mono text-sm">
        <span>{number}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(number);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <Copy className="size-3" />
        </button>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </button>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      {children}
    </div>
  );
}
