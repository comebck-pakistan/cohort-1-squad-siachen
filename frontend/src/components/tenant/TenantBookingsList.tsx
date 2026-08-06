import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Phone,
  ShieldAlert,
  User as UserIcon,
  X,
  Check,
} from "lucide-react";
import { api, qk } from "@/lib/api";
import type { AppointmentRow } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /salon-portal/bookings — bookings table for the selected day
//
// Day = "today" uses GET /api/business/:id/today (PKT day boundary) and
// auto-refreshes every minute. Switching to a specific date calls
// /api/business/:id/bookings?date=YYYY-MM-DD. Each row carries an
// appointment id so the inline Confirm/Cancel buttons wire directly to
// PATCH /api/appointments/:id (Story 11).
// ---------------------------------------------------------------------------

const statusStyle: Record<AppointmentRow["status"], string> = {
  pending: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  confirmed: "bg-success-soft text-[oklch(0.35_0.12_145)] border-transparent",
  completed: "bg-muted text-muted-foreground border-transparent",
  cancelled: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
  no_show: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(s: string): Date {
  // s is "YYYY-MM-DD"; construct as local-noon to avoid TZ rollover fuzz.
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

function fmtTime(iso: string): string {
  // Convert UTC ISO → PKT HH:MM. Backend returns UTC timestamps.
  return new Date(iso).toLocaleTimeString("en-PK", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PK", {
    timeZone: "Asia/Karachi",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function TenantBookingsList() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";
  const today = useMemo(() => toIsoDate(new Date()), []);
  const [date, setDate] = useState(today);

  const isToday = date === today;

  // Two separate queries to keep refetch cadence appropriate per mode:
  // today polls every 60s (new bookings can appear); explicit date just
  // loads once.
  const todayQ = useQuery({
    queryKey: businessId ? qk.businessToday(businessId) : ["bookings", "today", "none"],
    queryFn: () => api.businessToday(businessId),
    enabled: !!businessId && isToday,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const dateQ = useQuery({
    queryKey: businessId
      ? qk.businessBookings(businessId, date)
      : ["bookings", "date", date, "none"],
    queryFn: () => api.businessBookings(businessId, date),
    enabled: !!businessId && !isToday,
    staleTime: 60_000,
  });

  const q = isToday ? todayQ : dateQ;
  const all = q.data?.appointments ?? [];

  // Stats summary
  const counts = all.reduce<Record<AppointmentRow["status"], number>>(
    (acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    },
    { pending: 0, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 },
  );

  const displayDate = useMemo(() => fmtDate(new Date(parseIsoDate(date)).toISOString()), [date]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
          <p className="text-sm text-muted-foreground">
            All appointments for the selected day, in Asia/Karachi time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Date
            </label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={toIsoDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))}
              className="w-44 bg-background"
            />
          </div>
          {isToday ? null : (
            <Button size="sm" variant="outline" onClick={() => setDate(today)}>
              Jump to today
            </Button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Clock className="size-4" />}
          label="Pending"
          value={counts.pending}
          tone="warning"
        />
        <StatCard
          icon={<CheckCircle2 className="size-4" />}
          label="Confirmed"
          value={counts.confirmed}
          tone="success"
        />
        <StatCard
          icon={<CheckCircle2 className="size-4" />}
          label="Completed"
          value={counts.completed}
          tone="muted"
        />
        <StatCard
          icon={<X className="size-4" />}
          label="Cancelled / No-show"
          value={counts.cancelled + counts.no_show}
          tone="danger"
        />
      </div>

      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" />
            {displayDate}
            <span className="text-xs text-muted-foreground font-normal">
              · {all.length} booking{all.length === 1 ? "" : "s"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : q.isError ? (
            <div className="p-6 flex items-start gap-3">
              <ShieldAlert className="size-5 text-destructive mt-0.5" />
              <div>
                <div className="text-sm font-medium">Could not load bookings</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {String((q.error as Error)?.message || "Unknown error")}
                </div>
              </div>
            </div>
          ) : all.length === 0 ? (
            <div className="p-12 text-center">
              <CalendarDays className="size-8 text-muted-foreground mx-auto" />
              <div className="mt-3 text-sm font-medium">No bookings yet</div>
              <div className="text-xs text-muted-foreground">
                {isToday
                  ? "When customers book via WhatsApp, they'll show up here. Auto-refreshes every minute."
                  : "No appointments scheduled for this date."}
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Stylist</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map((a) => (
                  <BookingRow key={a.id} appt={a} onMutated={() => q.refetch()} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BookingRow({ appt, onMutated }: { appt: AppointmentRow; onMutated: () => void }) {
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (body: { status?: AppointmentRow["status"] }) =>
      api.patchAppointment(appt.id, body),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.status === "cancelled"
          ? "Appointment cancelled"
          : vars.status === "confirmed"
            ? "Appointment confirmed"
            : "Appointment updated",
      );
      // Invalidate every bookings-related cache key the BookingsList uses,
      // and the conversations list (so the Inbox's next_appointment
      // reflects the new status).
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      onMutated();
    },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  });

  const customerName = appt.customer?.name || appt.customer?.phone || "—";
  const canConfirm = appt.status === "pending";
  const canCancel = appt.status === "pending" || appt.status === "confirmed";
  const canComplete = appt.status === "pending" || appt.status === "confirmed";

  return (
    <TableRow>
      <TableCell className="text-sm tabular-nums font-medium">
        {fmtTime(appt.start_time)}
      </TableCell>
      <TableCell>
        <div className="text-sm font-medium">{customerName}</div>
        {appt.customer?.phone && appt.customer.name ? (
          <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Phone className="size-3" /> {appt.customer.phone}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-sm">{appt.service?.name ?? "—"}</TableCell>
      <TableCell>
        {appt.staff?.name ? (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <UserIcon className="size-3.5 text-muted-foreground" />
            {appt.staff.name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">unassigned</span>
        )}
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground font-mono">
          {appt.source}
        </span>
      </TableCell>
      <TableCell>
        <Badge
          className={cn(
            "text-[10px] font-medium border-transparent capitalize",
            statusStyle[appt.status],
          )}
        >
          {appt.status.replace("_", " ")}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-2">
          {canConfirm && (
            <Button
              size="sm"
              variant="outline"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ status: "confirmed" })}
            >
              <Check className="size-4" /> Confirm
            </Button>
          )}
          {canComplete && (
            <Button
              size="sm"
              variant="outline"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ status: "completed" })}
              className="border-[oklch(0.55_0.15_145)] text-[oklch(0.35_0.12_145)] hover:bg-success-soft"
            >
              <CheckCircle2 className="size-4" /> Complete
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="ghost"
              disabled={patch.isPending}
              onClick={() => {
                if (confirm(`Cancel ${customerName}'s ${appt.service?.name ?? "appointment"}?`)) {
                  patch.mutate({ status: "cancelled" });
                }
              }}
              className="text-destructive hover:text-destructive"
            >
              <X className="size-4" /> Cancel
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "warning" | "success" | "muted" | "danger";
}) {
  const toneClass: Record<typeof tone, string> = {
    warning: "bg-warning-soft text-[oklch(0.35_0.1_70)]",
    success: "bg-success-soft text-[oklch(0.35_0.12_145)]",
    muted: "bg-muted text-muted-foreground",
    danger: "bg-danger-soft text-[oklch(0.4_0.18_27)]",
  };
  return (
    <Card className="border shadow-none bg-white">
      <CardContent className="p-4 flex items-center gap-3">
        <div
          className={cn(
            "size-9 rounded-md grid place-items-center shrink-0",
            toneClass[tone],
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {label}
          </div>
          <div className="text-xl font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
