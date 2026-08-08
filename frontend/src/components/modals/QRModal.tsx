import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Smartphone,
  QrCode,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, qk } from "@/lib/api";
import type { Business, OnboardingStatus } from "@/types";

interface Props {
  open: boolean;
  business: Business | null;
  onOpenChange: (v: boolean) => void;
}

const statusMeta: Record<
  OnboardingStatus["status"],
  { label: string; className: string }
> = {
  initializing: {
    label: "Booting Chromium…",
    className: "bg-muted text-muted-foreground",
  },
  qr_pending: {
    label: "QR ready — scan now",
    className: "bg-warning-soft text-[oklch(0.35_0.1_70)]",
  },
  qr_ready: {
    label: "QR ready — scan now",
    className: "bg-warning-soft text-[oklch(0.35_0.1_70)]",
  },
  code_pending: {
    label: "Phone pairing — enter code below",
    className: "bg-warning-soft text-[oklch(0.35_0.1_70)]",
  },
  authenticated: {
    label: "Authenticated — syncing…",
    className: "bg-warning-soft text-[oklch(0.35_0.1_70)]",
  },
  ready: {
    label: "Connected",
    className: "bg-success-soft text-[oklch(0.35_0.12_145)]",
  },
  disconnected: {
    label: "Disconnected — will retry",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)]",
  },
  expired: {
    label: "Session expired — try again",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)]",
  },
  not_found: {
    label: "Session not found",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)]",
  },
};

// Fallback for any future bridge status the frontend doesn't know about —
// keep the modal alive instead of crashing the React tree on an unknown key.
function metaFor(s: string) {
  return (
    statusMeta[s as OnboardingStatus["status"]] ?? {
      label: `Status: ${s}`,
      className: "bg-muted text-muted-foreground",
    }
  );
}

/**
 * Format the raw 8-char pairing code from the library as XXXX-XXXX
 * the way WhatsApp displays it in its own Linked Devices UI. Defensive
 * against malformed input (returns a placeholder if shape is off).
 */
function formatPairingCode(raw: string | null | undefined): string {
  if (!raw) return "--------";
  if (raw.length !== 8) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * Sanity-check the phone number input the user types. Library wants
 * raw digits with country code, no '+', no spaces, no dashes (E.164).
 * 8-15 digits per E.164 spec — matches whatsapp-web.js's documented
 * format ("international, symbol-free").
 */
function sanitizePhoneInput(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}

function isPhoneValid(digits: string): boolean {
  return digits.length >= 8 && digits.length <= 15;
}

type PairingMethod = "qr" | "phone";

export function QRModal({ open, business, onOpenChange }: Props) {
  const [method, setMethod] = useState<PairingMethod>("qr");
  const [phoneInput, setPhoneInput] = useState("");

  const status = useQuery({
    queryKey: business ? qk.onboarding(business.id) : ["onboarding", "none"],
    queryFn: () => api.onboardingStatus(business!.id),
    enabled: open && !!business,
    refetchInterval: 2500,
  });

  const qc = useQueryClient();

  // Mutation to trigger phone pairing. On success the next /status
  // poll (≤2.5s) picks up pairing_method='phone' + status='code_pending'
  // and the modal flips to the code display automatically.
  const pairMutation = useMutation({
    mutationFn: (digits: string) => api.pairWithPhone(business!.id, digits),
    onSuccess: () => {
      // Invalidate status so the modal shows the new state right away
      // rather than waiting up to 2.5s for the next interval tick.
      qc.invalidateQueries({ queryKey: qk.onboarding(business!.id) });
    },
  });

  const s = status.data?.status ?? "initializing";
  const meta = metaFor(s);
  const pairingCode = status.data?.pairing_code ?? null;
  // BUGFIX: don't let the bridge's default `pairing_method: "qr"`
  // override the user's local toggle. The bridge value is only the
  // source of truth when it's "phone" (proves a phone-pairing call
  // has actually landed). Before that, the user's local selection
  // drives the UI.
  const bridgeMethod = status.data?.pairing_method;
  const effectiveMethod: PairingMethod =
    bridgeMethod === "phone" ? "phone" : method;

  const sanitizedPhone = sanitizePhoneInput(phoneInput);
  const phoneValid = isPhoneValid(sanitizedPhone);
  const pairError = pairMutation.error
    ? (pairMutation.error as Error).message
    : null;

  const isConnected = s === "ready" || s === "authenticated";

  // Debug — surfaces the resolved method + key derived flags so we
  // can see what the UI is rendering. Remove once the toggle works
  // reliably end-to-end.
  // eslint-disable-next-line no-console
  console.log("[QRModal] render", {
    s,
    method,
    bridgePairingMethod: status.data?.pairing_method,
    effectiveMethod,
    pairingCodePresent: !!pairingCode,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pair WhatsApp Web</DialogTitle>
          <DialogDescription>
            {business ? business.name : "—"} — link this salon's WhatsApp to
            Recepta.
          </DialogDescription>
        </DialogHeader>

        {/* ----------------------------------------------------------------
            Method toggle — QR is primary, Phone is secondary (same pattern
            WhatsApp's own UI uses). Hidden once pairing is successful so
            the user can't accidentally re-trigger after linking.
           ---------------------------------------------------------------- */}
        {!isConnected && (
          <div className="flex gap-2">
            <Button
              variant={effectiveMethod === "qr" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => {
                // eslint-disable-next-line no-console
                console.log("[QRModal] toggle click → qr");
                setMethod("qr");
              }}
              disabled={pairMutation.isPending}
            >
              <QrCode className="size-4" />
              Scan QR code
            </Button>
            <Button
              variant={effectiveMethod === "phone" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => {
                // eslint-disable-next-line no-console
                console.log("[QRModal] toggle click → phone", {
                  prev: effectiveMethod,
                  willSet: "phone",
                });
                setMethod("phone");
              }}
              disabled={pairMutation.isPending}
            >
              <Smartphone className="size-4" />
              Link with phone number instead
            </Button>
          </div>
        )}

        <div className="flex flex-col items-center gap-4 py-2">
          {/* ============================================================
              QR MODE — show scannable QR
             ============================================================ */}
          {effectiveMethod === "qr" && (
            <div className="size-56 rounded-lg border bg-white grid place-items-center relative overflow-hidden p-3">
              {status.isLoading ? (
                <Skeleton className="size-full animate-pulse" />
              ) : s === "ready" ? (
                <div className="flex flex-col items-center gap-2 text-[oklch(0.4_0.14_145)]">
                  <CheckCircle2 className="size-12" />
                  <div className="text-sm font-medium">Session active</div>
                </div>
              ) : s === "not_found" ||
                s === "disconnected" ||
                s === "expired" ? (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <AlertTriangle className="size-10" />
                  <div className="text-xs">
                    {s === "not_found"
                      ? "No session found"
                      : s === "disconnected"
                        ? "Disconnected from WhatsApp"
                        : "Session expired — try again"}
                  </div>
                </div>
              ) : (s === "qr_pending" || s === "qr_ready") &&
                status.data?.qr ? (
                // Render the real, scannable QR. `qr` is the raw string the
                // bridge returns; qrcode.react encodes it as an SVG.
                // size=200 keeps it within the 224px panel with padding.
                <QRCodeSVG
                  value={status.data.qr}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              ) : s === "qr_pending" || s === "qr_ready" ? (
                // Status says QR is ready but no string yet — transient.
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-8 animate-spin" />
                  <div className="text-xs">Awaiting QR payload…</div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-8 animate-spin" />
                  <div className="text-xs">Booting Chromium session…</div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================
              PHONE MODE — input + Submit button OR code display
             ============================================================ */}
          {effectiveMethod === "phone" && (
            <div className="w-full flex flex-col gap-3">
              {/* Initial state: form. Hidden once code arrives. */}
              {s !== "code_pending" && s !== "authenticated" && s !== "ready" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="phone-number" className="text-sm">
                    Salon's WhatsApp number
                  </Label>
                  <Input
                    id="phone-number"
                    type="tel"
                    inputMode="numeric"
                    placeholder="923001234567"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    disabled={pairMutation.isPending}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Digits only, country code first (e.g. 92 for Pakistan, no
                    "+"). 8–15 digits.
                  </p>
                  <Button
                    onClick={() => pairMutation.mutate(sanitizedPhone)}
                    disabled={!phoneValid || pairMutation.isPending}
                    className="mt-1"
                  >
                    {pairMutation.isPending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Generating code…
                      </>
                    ) : (
                      "Generate pairing code"
                    )}
                  </Button>
                  {pairError && (
                    <p className="text-xs text-destructive">{pairError}</p>
                  )}
                </div>
              )}

              {/* Code display — replaces form once bridge returns a code. */}
              {s === "code_pending" && (
                <div className="flex flex-col items-center gap-3 py-2">
                  <p className="text-xs text-muted-foreground text-center">
                    On your salon's WhatsApp:
                    <br />
                    <span className="font-medium">
                      Settings → Linked Devices → Link a Device → Link with
                      phone number instead
                    </span>
                    <br />
                    Then enter this code:
                  </p>
                  <div
                    className="font-mono text-3xl font-bold tracking-widest px-6 py-4 rounded-lg bg-muted border select-all"
                    aria-label="pairing code"
                    data-testid="pairing-code"
                  >
                    {formatPairingCode(pairingCode)}
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Code rotates automatically every few minutes. Auto-refreshes
                    below.
                  </p>
                </div>
              )}

              {/* Connected states — success checkmark, mirrors QR branch. */}
              {(s === "authenticated" || s === "ready") && (
                <div className="flex flex-col items-center gap-2 py-4 text-[oklch(0.4_0.14_145)]">
                  <CheckCircle2 className="size-12" />
                  <div className="text-sm font-medium">Session active</div>
                </div>
              )}
            </div>
          )}

          <Badge className={`${meta.className} border-transparent font-medium`}>
            {meta.label}
          </Badge>

          <div className="text-xs text-muted-foreground text-center">
            {effectiveMethod === "qr"
              ? "Open WhatsApp on your phone → Settings → Linked Devices → Link a Device"
              : "Auto-refreshes every 2.5s"}
          </div>

          {business && (
            <div className="text-xs text-muted-foreground font-mono">
              businessId: {business.id}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
