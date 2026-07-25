import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { SafetyRules, TierLimits } from "@/types";

export function SettingsTab() {
  const qc = useQueryClient();
  const tiers = useQuery({ queryKey: qk.tierLimits, queryFn: api.tierLimits });
  const safety = useQuery({ queryKey: qk.safety, queryFn: api.safetyRules });

  const [rows, setRows] = useState<TierLimits[]>([]);
  const [hard, setHard] = useState("");
  const [soft, setSoft] = useState("");

  useEffect(() => { if (tiers.data) setRows(tiers.data); }, [tiers.data]);
  useEffect(() => {
    if (safety.data) {
      setHard(safety.data.hard.join("\n"));
      setSoft(safety.data.soft.join("\n"));
    }
  }, [safety.data]);

  const saveTiers = useMutation({
    mutationFn: (r: TierLimits[]) => api.updateTierLimits(r),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tierLimits });
      toast.success("Tier limits saved");
    },
  });
  const saveSafety = useMutation({
    mutationFn: (r: SafetyRules) => api.updateSafetyRules(r),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.safety });
      toast.success("Safety rules saved");
    },
  });

  const setRow = (i: number, patch: Partial<TierLimits>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-6">
      <Card className="border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tier limits</CardTitle>
        </CardHeader>
        <CardContent>
          {tiers.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-[120px_1fr_1fr_1fr] gap-3 text-xs uppercase tracking-wide text-muted-foreground px-1">
                <div>Tier</div>
                <div>Monthly messages</div>
                <div>Concurrent agents</div>
                <div>Price (PKR / mo)</div>
              </div>
              {rows.map((r, i) => (
                <div key={r.tier} className="grid grid-cols-[120px_1fr_1fr_1fr] gap-3 items-center">
                  <div className="font-medium capitalize">{r.tier}</div>
                  <Input
                    type="number" value={r.monthlyMessages}
                    onChange={(e) => setRow(i, { monthlyMessages: Number(e.target.value) })}
                  />
                  <Input
                    type="number" value={r.concurrentAgents}
                    onChange={(e) => setRow(i, { concurrentAgents: Number(e.target.value) })}
                  />
                  <Input
                    type="number" value={r.pricePKR}
                    onChange={(e) => setRow(i, { pricePKR: Number(e.target.value) })}
                  />
                </div>
              ))}
              <div className="flex justify-end">
                <Button onClick={() => saveTiers.mutate(rows)} disabled={saveTiers.isPending}>
                  {saveTiers.isPending ? "Saving…" : "Save tier limits"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">AI Platform Safety Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {safety.isLoading ? (
            <Skeleton className="h-48 w-full animate-pulse" />
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-sm">
                    <ShieldAlert className="size-4 text-[oklch(0.4_0.18_27)]" />
                    Hard guardrails
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    One rule per line. Violations block the agent response.
                  </p>
                  <Textarea rows={8} value={hard} onChange={(e) => setHard(e.target.value)} className="font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-sm">
                    <ShieldCheck className="size-4 text-primary" />
                    Soft guardrails
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Preferences the LLM tries to follow when replying.
                  </p>
                  <Textarea rows={8} value={soft} onChange={(e) => setSoft(e.target.value)} className="font-mono text-sm" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() =>
                    saveSafety.mutate({
                      hard: hard.split("\n").map((s) => s.trim()).filter(Boolean),
                      soft: soft.split("\n").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  disabled={saveSafety.isPending}
                >
                  {saveSafety.isPending ? "Saving…" : "Save safety rules"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}