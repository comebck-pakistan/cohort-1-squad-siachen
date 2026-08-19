// ---------------------------------------------------------------------------
// EditWindowDialog.tsx — Radix Dialog for editing an open maintenance window.
// Editable fields: message, cooldownMinutes, endsAt, reason.
//
// Setting endsAt to a past time will cause the backend to auto-close the
// window. We surface a warning before the user submits but don't block.
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

import { api } from "@/lib/api";
import { isoToLocalDateTime, localDateTimeToIso } from "@/lib/maintenance-helpers";
import type { MaintenanceWindowRow } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  window: MaintenanceWindowRow;
}

export function EditWindowDialog({ open, onOpenChange, window: w }: Props) {
  const qc = useQueryClient();
  const [message, setMessage] = useState(w.message);
  const [cooldownMinutes, setCooldownMinutes] = useState(w.cooldown_minutes);
  const [endsAtLocal, setEndsAtLocal] = useState(isoToLocalDateTime(w.ends_at));
  const [reason, setReason] = useState("");

  const endsAtMs = endsAtLocal ? new Date(endsAtLocal).getTime() : null;
  const endsInPast = endsAtMs !== null && endsAtMs <= Date.now();
  const hasChanges =
    message !== w.message ||
    cooldownMinutes !== w.cooldown_minutes ||
    isoToLocalDateTime(w.ends_at) !== endsAtLocal ||
    reason.trim().length > 0;

  const messageError =
    message.trim().length < 1
      ? "Required"
      : message.length > 1000
        ? "Max 1000"
        : null;
  const cooldownError =
    !Number.isFinite(cooldownMinutes) || cooldownMinutes < 0
      ? "Must be ≥ 0"
      : cooldownMinutes > 1440
        ? "Max 1440"
        : null;
  const endsAtError =
    endsAtLocal && isNaN(new Date(endsAtLocal).getTime())
      ? "Invalid date"
      : null;
  const canSubmit =
    !messageError && !cooldownError && !endsAtError && hasChanges;

  const mut = useMutation({
    mutationFn: () => {
      const body: {
        message?: string;
        cooldownMinutes?: number;
        endsAt?: string;
        reason?: string;
      } = {};
      if (message !== w.message) body.message = message.trim();
      if (cooldownMinutes !== w.cooldown_minutes)
        body.cooldownMinutes = Number(cooldownMinutes);
      if (isoToLocalDateTime(w.ends_at) !== endsAtLocal) {
        body.endsAt = localDateTimeToIso(endsAtLocal) ?? undefined;
      }
      if (reason.trim()) body.reason = reason.trim();
      return api.updateMaintenanceWindow(w.id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      toast.success("Window updated");
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(`Update failed: ${e.message}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit maintenance window</DialogTitle>
          <DialogDescription>
            {w.scope === "global" ? "Global" : "Salon-scoped"} window
            {w.salon_id ? ` · ${w.salon_id.slice(0, 8)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-msg">Message</Label>
            <Textarea
              id="edit-msg"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="text-destructive">{messageError ?? " "}</span>
              <span className="tabular-nums">{message.length}/1000</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-cooldown">Cooldown (min)</Label>
              <Input
                id="edit-cooldown"
                type="number"
                min={0}
                max={1440}
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(Number(e.target.value))}
              />
              {cooldownError && (
                <p className="text-xs text-destructive">{cooldownError}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-ends-at">Ends at</Label>
              <Input
                id="edit-ends-at"
                type="datetime-local"
                value={endsAtLocal}
                onChange={(e) => setEndsAtLocal(e.target.value)}
              />
              {endsAtError && (
                <p className="text-xs text-destructive">{endsAtError}</p>
              )}
            </div>
          </div>

          {endsInPast && (
            <p className="text-xs text-destructive bg-danger-soft/40 rounded-md px-3 py-2">
              This will close the window immediately on save.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-reason">Reason for change (optional)</Label>
            <Input
              id="edit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
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
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
