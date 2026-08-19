// ---------------------------------------------------------------------------
// EnableMaintenanceDialog.tsx — Radix Dialog for opening a new maintenance
// window. Two modes: 'global' (no salon picker) and 'salon' (with picker).
//
// All form state is controlled. Submit is wired to api.enableGlobalMaintenance
// or api.enableSalonMaintenance. Invalidate all maintenance queries on success.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
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
import {
  localDateTimeToIso,
  minutesFromNowIso,
  validateEnableForm,
} from "@/lib/maintenance-helpers";
import type { Business } from "@/types";

const FALLBACK_MESSAGE =
  "We're temporarily offline for maintenance. Please try again in a few minutes.";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "global" | "salon";
  salons: Business[];
}

export function EnableMaintenanceDialog({ open, onOpenChange, mode, salons }: Props) {
  const qc = useQueryClient();
  const [message, setMessage] = useState(FALLBACK_MESSAGE);
  const [cooldownMinutes, setCooldownMinutes] = useState(30);
  const [endsAtLocal, setEndsAtLocal] = useState(() => {
    // Default: 30 min from now, formatted for <input type="datetime-local">
    const d = new Date(Date.now() + 30 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  });
  const [reason, setReason] = useState("");
  const [salonId, setSalonId] = useState<string | null>(null);
  const [salonSearch, setSalonSearch] = useState("");

  const errors = validateEnableForm({
    message,
    cooldownMinutes,
    endsAtLocal,
    startsAtLocal: "",
    reason,
    salonId: mode === "salon" ? salonId : "global",
  });

  const reset = () => {
    setMessage(FALLBACK_MESSAGE);
    setCooldownMinutes(30);
    setReason("");
    setSalonId(null);
    setSalonSearch("");
  };

  const mut = useMutation({
    mutationFn: async () => {
      const body = {
        message: message.trim(),
        cooldownMinutes: Number(cooldownMinutes),
        endsAt: localDateTimeToIso(endsAtLocal) ?? minutesFromNowIso(30),
        reason: reason.trim() || undefined,
      };
      if (mode === "global") {
        return api.enableGlobalMaintenance(body);
      }
      if (!salonId) throw new Error("Salon is required");
      return api.enableSalonMaintenance(salonId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      toast.success(
        mode === "global"
          ? "Global maintenance enabled"
          : "Maintenance enabled for salon",
      );
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(`Failed: ${e.message}`);
    },
  });

  const filteredSalons = salons.filter((s) => {
    const q = salonSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.whatsapp_number?.toLowerCase().includes(q) ||
      s.city?.toLowerCase().includes(q)
    );
  });

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
            {mode === "global" ? "Enable global maintenance" : "Enable maintenance for a salon"}
          </DialogTitle>
          <DialogDescription>
            All customer messages will receive a fixed reply. A 30-minute
            per-customer cooldown prevents spam.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === "salon" && (
            <div className="space-y-1.5">
              <Label htmlFor="salon-picker">Salon</Label>
              <div className="relative">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="salon-picker-search"
                  placeholder="Search by name, number, or city"
                  value={salonSearch}
                  onChange={(e) => setSalonSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={salonId ?? ""}
                onValueChange={(v) => setSalonId(v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a salon" />
                </SelectTrigger>
                <SelectContent>
                  {filteredSalons.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No salons match.
                    </div>
                  )}
                  {filteredSalons.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.whatsapp_number ? ` · ${s.whatsapp_number}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.salonId && (
                <p className="text-xs text-destructive">{errors.salonId}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="msg">Message sent to customers</Label>
            <Textarea
              id="msg"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{errors.message ?? " "}</span>
              <span className="tabular-nums">{message.length}/1000</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cooldown">Cooldown (minutes)</Label>
              <Input
                id="cooldown"
                type="number"
                min={0}
                max={1440}
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                0–1440. Per-customer dedup.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ends-at">Ends at (optional)</Label>
              <Input
                id="ends-at"
                type="datetime-local"
                value={endsAtLocal}
                onChange={(e) => setEndsAtLocal(e.target.value)}
              />
              {errors.endsAt && (
                <p className="text-xs text-destructive">{errors.endsAt}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Internal reason (optional)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="DB migration, model swap, incident #1234..."
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
            disabled={
              mut.isPending ||
              Boolean(errors.message) ||
              Boolean(errors.cooldownMinutes) ||
              Boolean(errors.endsAt) ||
              (mode === "salon" && !salonId)
            }
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            Enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
