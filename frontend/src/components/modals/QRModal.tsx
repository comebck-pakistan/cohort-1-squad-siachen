import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, QrCode, AlertTriangle } from "lucide-react";
import { api, qk } from "@/lib/api";
import type { Business, OnboardingStatus } from "@/types";

interface Props {
  open: boolean;
  business: Business | null;
  onOpenChange: (v: boolean) => void;
}

const statusMeta: Record<OnboardingStatus["status"], { label: string; className: string }> = {
  initializing: { label: "Initializing", className: "bg-muted text-muted-foreground" },
  qr_ready: { label: "QR ready — scan now", className: "bg-warning-soft text-[oklch(0.35_0.1_70)]" },
  ready: { label: "Connected", className: "bg-success-soft text-[oklch(0.35_0.12_145)]" },
  not_found: { label: "Session not found", className: "bg-danger-soft text-[oklch(0.4_0.18_27)]" },
};

export function QRModal({ open, business, onOpenChange }: Props) {
  const status = useQuery({
    queryKey: business ? qk.onboarding(business.id) : ["onboarding", "none"],
    queryFn: () => api.onboardingStatus(business!.id),
    enabled: open && !!business,
    refetchInterval: 2500,
  });

  const s = status.data?.status ?? "initializing";
  const meta = statusMeta[s];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pair WhatsApp Web</DialogTitle>
          <DialogDescription>
            {business ? business.name : "—"} — scan the QR from WhatsApp → Linked Devices.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="size-56 rounded-lg border bg-muted grid place-items-center relative overflow-hidden">
            {status.isLoading ? (
              <Skeleton className="size-full animate-pulse" />
            ) : s === "ready" ? (
              <div className="flex flex-col items-center gap-2 text-[oklch(0.4_0.14_145)]">
                <CheckCircle2 className="size-12" />
                <div className="text-sm font-medium">Session active</div>
              </div>
            ) : s === "not_found" ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-10" />
                <div className="text-xs">No session found</div>
              </div>
            ) : s === "qr_ready" ? (
              <div className="flex flex-col items-center gap-2 text-foreground">
                <QrCode className="size-32" strokeWidth={1.25} />
                <div className="text-xs text-muted-foreground">Auto-refreshes every 2.5s</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="size-8 animate-spin" />
                <div className="text-xs">Booting Chromium session…</div>
              </div>
            )}
          </div>

          <Badge className={`${meta.className} border-transparent font-medium`}>{meta.label}</Badge>

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