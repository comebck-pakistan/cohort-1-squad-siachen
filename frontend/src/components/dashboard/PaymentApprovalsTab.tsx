import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Image as ImageIcon, ExternalLink } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// PaymentApprovalsTab — Wave 13.
//
// Superadmin-only review queue for manual payment approvals. Buyers send
// money via JazzCash/EasyPaisa/bank, upload a screenshot, and create a
// payment_request row. This tab lets the admin review + approve (which
// activates the subscription) or reject (with a reason).
//
// Matches the SalonsTab pattern: useQuery + useMutation + invalidate
// queries on success. Uses Sonner toasts for feedback.
// ---------------------------------------------------------------------------

type PaymentStatus = "pending" | "approved" | "rejected" | "expired";

interface PaymentRow {
  id: string;
  business_id: string | null;
  plan_id: string;
  amount_pkr: number;
  payment_method: "jazzcash" | "easypaisa" | "bank_transfer";
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_whatsapp: string | null;
  transaction_reference: string | null;
  screenshot_url: string | null;
  status: PaymentStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export function PaymentApprovalsTab() {
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "all">("pending");
  const [rejectFor, setRejectFor] = useState<PaymentRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [screenshotFor, setScreenshotFor] = useState<PaymentRow | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const qc = useQueryClient();
  const list = useQuery({
    queryKey: qk.pendingPayments(statusFilter === "all" ? undefined : statusFilter),
    queryFn: () =>
      api.listPendingPayments(statusFilter === "all" ? undefined : statusFilter),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.approvePayment(id),
    onSuccess: (_data, id) => {
      toast.success("Payment approved — subscription activated");
      qc.invalidateQueries({ queryKey: ["payments"] });
      // The salon's subscription state changed in Supabase. Invalidate
      // the per-salon keys so the owner's next visit (or a tab-focus
      // event) refetches fresh data and stops showing the pre-approval
      // trial/basic state. Without this, the superadmin dashboard is
      // healthy but the salon owner side stays stale.
      const row = rows.find((r) => r.id === id);
      const businessId = row?.business_id ?? null;
      if (businessId) {
        qc.invalidateQueries({ queryKey: qk.mySubscription(businessId) });
        qc.invalidateQueries({ queryKey: qk.myTrialStatus(businessId) });
        qc.invalidateQueries({ queryKey: qk.myAgentActive(businessId) });
      }
    },
    onError: (e: Error) => toast.error(`Approve failed: ${e.message}`),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.rejectPayment(id, reason),
    onSuccess: (_data, vars) => {
      toast.success("Payment rejected");
      qc.invalidateQueries({ queryKey: ["payments"] });
      // Rejection doesn't change the salon's subscription, but invalidate
      // anyway so if the business later retries and the previous row is
      // still cached anywhere, the next view refreshes.
      const row = rows.find((r) => r.id === vars.id);
      const businessId = row?.business_id ?? null;
      if (businessId) {
        qc.invalidateQueries({ queryKey: qk.mySubscription(businessId) });
      }
      setRejectFor(null);
      setRejectReason("");
    },
    onError: (e: Error) => toast.error(`Reject failed: ${e.message}`),
  });

  async function openScreenshot(row: PaymentRow) {
    setScreenshotFor(row);
    setSignedUrl(null);
    try {
      const result = await api.getPaymentScreenshotUrl(row.id);
      setSignedUrl(result.url);
    } catch (e) {
      toast.error(`Could not load screenshot: ${(e as Error).message}`);
    }
  }

  const rows = (list.data?.payments ?? []) as PaymentRow[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Payment approvals
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review JazzCash / EasyPaisa / bank transfer requests. Approving
            activates the salon's subscription for 30 days.
          </p>
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as PaymentStatus | "all")}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card">
        {list.isLoading ? (
          <div className="space-y-2 p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No {statusFilter === "all" ? "" : statusFilter} payments yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.customer_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.customer_email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.plan_id}</Badge>
                  </TableCell>
                  <TableCell className="font-mono">
                    PKR {r.amount_pkr.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <MethodBadge method={r.payment_method} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.transaction_reference ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <StatusPill status={r.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {r.screenshot_url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openScreenshot(r)}
                        >
                          <ImageIcon className="size-4" />
                        </Button>
                      )}
                      {r.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            disabled={approveMut.isPending}
                            onClick={() => approveMut.mutate(r.id)}
                          >
                            <CheckCircle2 className="mr-1 size-4" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRejectFor(r)}
                          >
                            <XCircle className="mr-1 size-4" />
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Reject modal */}
      <Dialog
        open={rejectFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectFor(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject payment</DialogTitle>
            <DialogDescription>
              The customer will see this reason. Be specific so they can
              correct and resubmit.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (e.g. screenshot unreadable, please resend)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectReason.length < 3 || rejectMut.isPending}
              onClick={() =>
                rejectFor &&
                rejectMut.mutate({ id: rejectFor.id, reason: rejectReason })
              }
            >
              Reject payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Screenshot modal */}
      <Dialog
        open={screenshotFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setScreenshotFor(null);
            setSignedUrl(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment screenshot</DialogTitle>
            <DialogDescription>
              {screenshotFor?.customer_name} ·{" "}
              {screenshotFor?.transaction_reference ?? "no reference"}
            </DialogDescription>
          </DialogHeader>
          {signedUrl ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <img src={signedUrl} alt="Payment screenshot" className="w-full" />
            </div>
          ) : (
            <div className="grid h-64 place-items-center text-sm text-muted-foreground">
              Loading…
            </div>
          )}
          {signedUrl && (
            <DialogFooter>
              <Button asChild variant="outline">
                <a href={signedUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 size-4" />
                  Open in new tab
                </a>
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MethodBadge({
  method,
}: {
  method: "jazzcash" | "easypaisa" | "bank_transfer";
}) {
  const label = {
    jazzcash: "JazzCash",
    easypaisa: "EasyPaisa",
    bank_transfer: "Bank",
  }[method];
  return <Badge variant="secondary">{label}</Badge>;
}

function StatusPill({ status }: { status: PaymentStatus }) {
  if (status === "pending") {
    return (
      <Badge className="bg-amber-100 text-amber-900 border-transparent">
        Pending
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge className="bg-emerald-100 text-emerald-900 border-transparent">
        Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="bg-red-100 text-red-900 border-transparent">
        Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Expired
    </Badge>
  );
}
