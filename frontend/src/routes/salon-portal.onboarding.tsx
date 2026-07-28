import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  ExternalLink,
  RefreshCcw,
  Smartphone,
  PowerOff,
  Cloud,
  MessageSquare,
} from "lucide-react";
import { useEffect } from "react";
import { api, qk } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";
import { toast } from "sonner";
import type { OnboardingStatus } from "@/types";
import { QRCodeSVG } from "qrcode.react";

// ---------------------------------------------------------------------------
// /salon-portal/onboarding — owner-facing WhatsApp connection page.
//
// Default path: QR pairing (whatsapp-web.js transport).
// Every new salon signs up, opens this page, and scans the QR with their
// salon phone. They are live in under a minute.
//
// The Meta Cloud branch is opt-in — it only shows when the salon already
// has a phone_number_id registered (set by the superadmin during manual
// Meta onboarding). For all freshly-signed-up salons, this page goes
// straight to QR pairing.
//
// The backend endpoint /api/business/:id/connection-info is the source
// of truth — it picks the right instructions text and tells the frontend
// whether QR pairing is even available.
// ---------------------------------------------------------------------------

const statusMeta: Record<
  OnboardingStatus["status"],
  { label: string; className: string; description: string }
> = {
  initializing: {
    label: "Booting Chromium session",
    className: "bg-muted text-muted-foreground border-transparent",
    description:
      "Booting chromium and connecting to web.whatsapp.com — first-time boot typically takes 30–90 seconds on a developer host. Leave this page open.",
  },
  qr_pending: {
    label: "QR ready — scan it",
    className:
      "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
    description:
      "Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → point at the QR.",
  },
  qr_ready: {
    label: "QR ready — scan it",
    className:
      "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
    description:
      "Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → point at the QR.",
  },
  ready: {
    label: "WhatsApp connected",
    className:
      "bg-success-soft text-[oklch(0.35_0.12_145)] border-transparent",
    description:
      "Customers who message your number now reach the AI receptionist.",
  },
  not_found: {
    label: "Session not registered",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
    description:
      "Click Restart pairing to start a new Chromium session for this salon.",
  },
  authenticated: {
    label: "Authenticated — finalizing…",
    className: "bg-muted text-muted-foreground border-transparent",
    description: "QR scanned successfully. Session is finalizing.",
  },
  disconnected: {
    label: "Disconnected",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
    description:
      "WhatsApp disconnected. Click Restart pairing to reconnect.",
  },
  expired: {
    label: "Session expired",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
    description:
      "The previous session expired. Click Restart pairing to re-link your WhatsApp.",
  },
  destroyed: {
    label: "Session destroyed",
    className: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
    description:
      "This session was destroyed. Click Restart pairing to start a new one.",
  },
};

// Safety net — the backend may add new statuses before the frontend
// learns about them. Fall back to a neutral "unknown" badge instead of
// crashing on `meta.className`.
function metaFor(status: OnboardingStatus["status"]) {
  return (
    statusMeta[status] || {
      label: `Status: ${status}`,
      className: "bg-muted text-muted-foreground border-transparent",
      description: "Awaiting next update from backend.",
    }
  );
}

export const Route = createFileRoute("/salon-portal/onboarding")({
  head: () => ({
    meta: [
      { title: "WhatsApp Connection — Recepta" },
      {
        name: "description",
        content:
          "Pair your salon's WhatsApp number with the Recepta AI receptionist.",
      },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const tenant = useTenantBusinessId();
  const qc = useQueryClient();
  const businessId = tenant.data?.businessId;

  // Transport-aware info — primary source of truth.
  const info = useQuery({
    queryKey: businessId ? ["connection-info", businessId] : ["connection-info", "none"],
    queryFn: () => api.connectionInfo(businessId!),
    enabled: !!businessId,
    staleTime: 60_000,
  });

  const register = useMutation({
    mutationFn: () => api.registerOnboarding(businessId!),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.onboarding(businessId!) }),
    onError: (e) =>
      toast.error("Could not start session", {
        description: String((e as Error).message),
      }),
  });

  useEffect(() => {
    // Auto-register once we know pairing is available (web transport).
    if (
      businessId &&
      info.data?.qr_pairing_available &&
      !register.isSuccess &&
      !register.isPending
    ) {
      register.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, info.data?.qr_pairing_available]);

  // Status polling — only meaningful when transport=web.
  const status = useQuery({
    queryKey: businessId ? qk.onboarding(businessId) : ["onboarding", "none"],
    queryFn: () => api.onboardingStatus(businessId!),
    enabled: !!businessId && info.data?.qr_pairing_available === true,
    refetchInterval: 2500,
  });

  const disconnect = useMutation({
    mutationFn: () =>
      fetch(
        `${(import.meta.env.VITE_API_URL as string) || ""}/onboarding/${businessId}/session`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      toast.success("WhatsApp session disconnected");
      qc.invalidateQueries({ queryKey: qk.onboarding(businessId!) });
    },
    onError: () => toast.error("Disconnect failed"),
  });

  if (!businessId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading your salon…
      </div>
    );
  }

  if (info.isLoading) {
    return (
      <div className="p-6 space-y-3 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          WhatsApp Connection
        </h1>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (info.isError) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          WhatsApp Connection
        </h1>
        <Card className="mt-4 border-danger-soft bg-danger-soft/30">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertTriangle className="size-5 text-[oklch(0.4_0.18_27)] mt-0.5" />
            <div>
              <div className="text-sm font-medium">
                Could not load connection info
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {String((info.error as Error)?.message || "")}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => info.refetch()}
              >
                <RefreshCcw className="size-4" /> Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Meta Cloud (opt-in): salon already has phone_number_id registered ----
  // This branch is reached only for salons whose superadmin has manually
  // wired them into Meta Business Suite. Newly-signed-up salons always go
  // to QR pairing below.
  if (info.data?.phone_number_id_set === true) {
    return (
      <CloudOnboarding
        info={info.data}
        businessId={businessId}
      />
    );
  }

  // ---- Default path: QR pairing (whatsapp-web.js) ----
  return (
    <WebOnboarding
      s={(status.data?.status ?? "initializing") as OnboardingStatus["status"]}
      statusLoading={status.isLoading}
      qr={status.data?.qr ?? null}
      info={info.data!}
      businessId={businessId}
      registerPending={register.isPending}
      onRestart={() => register.mutate()}
      onOpenPairingWindow={() => {
        window.open(
          api.onboardingPageUrl(businessId),
          "halo-pairing",
          "width=600,height=720,toolbar=no,location=no,status=no,menubar=no",
        );
      }}
      onDisconnect={() => disconnect.mutate()}
      disconnectPending={disconnect.isPending}
    />
  );
}

function CloudOnboarding({
  info,
  businessId,
}: {
  info: {
    phone_number_id_set: boolean;
    instructions: string;
    next_step: string;
    agent_active: boolean;
  };
  businessId: string;
}) {
  const isReady = info.phone_number_id_set;
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          WhatsApp Connection
        </h1>
        <p className="text-sm text-muted-foreground">
          Your salon is configured with the Meta Cloud API.
          {" "}
          Inbound messages flow through Meta directly — no QR pairing needed.
        </p>
      </div>

      <Card className="border shadow-none bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="size-4" />
            Meta Cloud connection
          </CardTitle>
          <CardDescription>
            Platform-level setting. Your salon's number is registered via Meta
            Business Suite and inbound messages arrive through the official
            webhook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={
              isReady
                ? "rounded-lg border border-success-soft bg-success-soft/30 p-5 flex items-start gap-3"
                : "rounded-lg border border-warning-soft bg-warning-soft/30 p-5 flex items-start gap-3"
            }
          >
            {isReady ? (
              <CheckCircle2 className="size-6 text-[oklch(0.4_0.14_145)] shrink-0" />
            ) : (
              <AlertTriangle className="size-6 text-[oklch(0.35_0.1_70)] shrink-0" />
            )}
            <div className="flex-1">
              <Badge
                className={
                  isReady
                    ? "bg-success-soft text-[oklch(0.35_0.12_145)] border-transparent"
                    : "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent"
                }
              >
                {isReady ? "Phone number linked" : "Phone number not yet linked"}
              </Badge>
              <p className="text-sm text-muted-foreground mt-2">
                {info.instructions}
              </p>
              {info.agent_active && (
                <p className="text-xs text-muted-foreground mt-2">
                  AI agent is currently <strong>active</strong> for this salon.
                </p>
              )}
            </div>
          </div>

          {isReady && info.next_step === "inbox" && (
            <Button asChild className="bg-primary hover:bg-primary/90">
              <Link to="/salon-portal/inbox">
                <MessageSquare className="size-4" />
                Go to inbox
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WebOnboarding({
  s,
  statusLoading,
  qr,
  info,
  businessId,
  registerPending,
  onRestart,
  onOpenPairingWindow,
  onDisconnect,
  disconnectPending,
}: {
  s: OnboardingStatus["status"];
  statusLoading: boolean;
  qr: string | null;
  info: { instructions: string };
  businessId: string;
  registerPending: boolean;
  onRestart: () => void;
  onOpenPairingWindow: () => void;
  onDisconnect: () => void;
  disconnectPending: boolean;
}) {
  const meta = metaFor(s);
  const isReady = s === "ready";
  const showQR = !isReady && qr !== null && qr.length > 0;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          WhatsApp Connection
        </h1>
        <p className="text-sm text-muted-foreground">
          Pair your salon's WhatsApp number with the Recepta AI receptionist.
          Once connected, every incoming message gets an instant AI reply.
        </p>
      </div>

      <Card className="border shadow-none bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4" /> Connection status
          </CardTitle>
          <CardDescription>
            Polled every 2.5 seconds. Status flips automatically when you scan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="rounded-lg border bg-muted/30 p-5 space-y-4">
              <div className="flex items-center gap-3">
                {s === "ready" ? (
                  <CheckCircle2 className="size-6 text-[oklch(0.4_0.14_145)]" />
                ) : s === "qr_ready" ? (
                  <Loader2 className="size-6 animate-spin text-[oklch(0.35_0.1_70)]" />
                ) : s === "not_found" ? (
                  <AlertTriangle className="size-6 text-[oklch(0.5_0.18_27)]" />
                ) : (
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                )}
                <Badge className={meta.className}>{meta.label}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {meta.description}
              </p>
              <p className="text-xs text-muted-foreground">{info.instructions}</p>

              {/* Inline QR — the same QR that powers the standalone backend
                  pairing page, rendered directly here via qrcode.react so
                  the salon owner doesn't have to pop a second window. */}
              {showQR && (
                <div className="flex flex-col items-center gap-3 pt-2">
                  <div className="rounded-2xl border-2 border-foreground/10 bg-white p-5 shadow-sm">
                    <QRCodeSVG
                      value={qr}
                      size={256}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#0d9488"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    QR refreshes automatically as it rotates.
                  </p>
                </div>
              )}

              {!isReady && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onRestart}
                    disabled={registerPending}
                  >
                    <RefreshCcw className="size-4" />
                    {registerPending ? "Starting…" : "Restart pairing"}
                  </Button>
                  {/* Always-available alongside Restart pairing — opens the
                      backend's HTML pairing page (which renders its own
                      QR server-side) in a popup. Useful on devices where
                      the inline SVG QR is hard to point a phone camera at,
                      or for a kiosk/secondary display flow. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onOpenPairingWindow}
                    disabled={!businessId}
                    className="text-muted-foreground"
                  >
                    <ExternalLink className="size-4" />
                    Open in window
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!isReady && (
        <Card className="border shadow-none bg-white">
          <CardHeader>
            <CardTitle className="text-base">How to scan</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm text-foreground/80 list-decimal pl-5">
              <li>
                The QR above is live — point your phone camera at it.
              </li>
              <li>
                On the salon phone, open WhatsApp → tap{" "}
                <strong>Settings</strong> → <strong>Linked Devices</strong> →{" "}
                <strong>Link a Device</strong>.
              </li>
              <li>
                Point the camera at the QR. Within a few seconds this page
                flips to <em>Connected</em>.
              </li>
            </ol>
          </CardContent>
        </Card>
      )}

      {isReady && (
        <Card className="border-success-soft bg-success-soft/30 shadow-none">
          <CardContent className="p-6 flex flex-col items-center text-center gap-3">
            <CheckCircle2 className="size-12 text-[oklch(0.4_0.14_145)]" />
            <div className="text-lg font-medium">You are live.</div>
            <div className="text-sm text-muted-foreground max-w-md">
              Send a test WhatsApp message to your salon number and you will
              see the AI respond within seconds.
            </div>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link to="/salon-portal/inbox">Go to inbox</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {isReady && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onDisconnect}
          disabled={disconnectPending}
          className="text-muted-foreground"
        >
          <PowerOff className="size-4" />
          {disconnectPending ? "Disconnecting…" : "Disconnect WhatsApp"}
        </Button>
      )}
    </div>
  );
}
