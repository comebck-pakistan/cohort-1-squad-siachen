// ---------------------------------------------------------------------------
// ComposeNotificationDialog.tsx — Radix Dialog for creating or editing a
// global notification. Mirrors EnableMaintenanceDialog.tsx for parity.
//
// Props: { open, onOpenChange, mode: 'create' | 'edit', initial?: NotificationRow }
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { api, qk } from "@/lib/api";
import { localDateTimeToIso, isoToLocalDateTime } from "@/lib/maintenance-helpers";
import type { NotificationRow, NotificationSeverity } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: NotificationRow | null;
}

const SEVERITIES: NotificationSeverity[] = ["info", "warning", "critical"];

interface FormState {
  title: string;
  body: string;
  severity: NotificationSeverity;
  startsAtLocal: string;
  endsAtLocal: string;
}

function defaultStartLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function validate(state: FormState): { title?: string; body?: string; endsAt?: string } {
  const errors: { title?: string; body?: string; endsAt?: string } = {};
  if (state.title.trim().length < 1) errors.title = "Required";
  else if (state.title.length > 200) errors.title = "Max 200 characters";
  if (state.body.trim().length < 1) errors.body = "Required";
  else if (state.body.length > 500) errors.body = "Max 500 characters";
  if (state.endsAtLocal) {
    const d = new Date(state.endsAtLocal);
    if (isNaN(d.getTime())) errors.endsAt = "Invalid date";
    else if (d.getTime() <= Date.now()) errors.endsAt = "Must be in the future";
  }
  return errors;
}

export function ComposeNotificationDialog({ open, onOpenChange, mode, initial }: Props) {
  const qc = useQueryClient();
  const [state, setState] = useState<FormState>(() => ({
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    severity: initial?.severity ?? "info",
    startsAtLocal: initial
      ? isoToLocalDateTime(initial.starts_at)
      : defaultStartLocal(),
    endsAtLocal: initial ? isoToLocalDateTime(initial.ends_at) : "",
  }));

  const errors = validate(state);
  const canSubmit = !errors.title && !errors.body && !errors.endsAt;

  const mut = useMutation({
    mutationFn: async () => {
      const startsAt = localDateTimeToIso(state.startsAtLocal) ?? undefined;
      const endsAt = state.endsAtLocal
        ? (localDateTimeToIso(state.endsAtLocal) ?? null)
        : null;
      if (mode === "create") {
        return api.createNotification({
          title: state.title.trim(),
          body: state.body.trim(),
          severity: state.severity,
          startsAt,
          endsAt,
        });
      }
      if (!initial) throw new Error("Edit mode requires initial row");
      return api.updateNotification(initial.id, {
        title: state.title.trim(),
        body: state.body.trim(),
        severity: state.severity,
        startsAt,
        endsAt,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(mode === "create" ? "Notification created" : "Notification updated");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const reset = () => {
    setState({
      title: initial?.title ?? "",
      body: initial?.body ?? "",
      severity: initial?.severity ?? "info",
      startsAtLocal: initial
        ? isoToLocalDateTime(initial.starts_at)
        : defaultStartLocal(),
      endsAtLocal: initial ? isoToLocalDateTime(initial.ends_at) : "",
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Compose new notification" : "Edit notification"}
          </DialogTitle>
          <DialogDescription>
            Visible to every logged-in dashboard until you archive it or it
            expires.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={state.title}
              onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
              maxLength={200}
              placeholder="Trial ending soon"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="text-destructive">{errors.title ?? " "}</span>
              <span className="tabular-nums">{state.title.length}/200</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Body</Label>
            <Textarea
              id="body"
              rows={3}
              value={state.body}
              onChange={(e) => setState((s) => ({ ...s, body: e.target.value }))}
              maxLength={500}
              placeholder="Your trial ends in 3 days. Upgrade to keep your bookings running."
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="text-destructive">{errors.body ?? " "}</span>
              <span className="tabular-nums">{state.body.length}/500</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="severity">Severity</Label>
              <Select
                value={state.severity}
                onValueChange={(v) =>
                  setState((s) => ({ ...s, severity: v as NotificationSeverity }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ends-at">Ends at (optional)</Label>
              <Input
                id="ends-at"
                type="datetime-local"
                value={state.endsAtLocal}
                onChange={(e) =>
                  setState((s) => ({ ...s, endsAtLocal: e.target.value }))
                }
              />
              {errors.endsAt && (
                <p className="text-xs text-destructive">{errors.endsAt}</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mut.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!canSubmit || mut.isPending}
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            {mode === "create" ? "Publish" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
