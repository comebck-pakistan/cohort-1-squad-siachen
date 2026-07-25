import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentStatusBadge as _unused, StatusBadge, TierBadge } from "./StatusBadge";
import { AlertTriangle, Plus, QrCode, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AddSalonModal } from "@/components/modals/AddSalonModal";
import { QRModal } from "@/components/modals/QRModal";
import { DeleteSalonModal } from "@/components/modals/DeleteSalonModal";
import type { BillingStatus, Business, Tier } from "@/types";

void _unused;

export function SalonsTab() {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "all">("all");
  const [city, setCity] = useState<string>("all");
  const [billing, setBilling] = useState<BillingStatus | "all">("all");
  const [openAdd, setOpenAdd] = useState(false);
  const [qrFor, setQrFor] = useState<Business | null>(null);
  const [deleteFor, setDeleteFor] = useState<Business | null>(null);

  const qc = useQueryClient();
  const salons = useQuery({ queryKey: qk.salons, queryFn: api.listSalons });

  const toggleAgent = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setAgentActive(id, active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.salons });
    },
    onError: () => toast.error("Failed to update agent status"),
  });

  const cities = useMemo(() => {
    const s = new Set<string>();
    salons.data?.forEach((b) => b.city && s.add(b.city));
    return Array.from(s);
  }, [salons.data]);

  const rows = useMemo(() => {
    const list = salons.data ?? [];
    return list.filter((b) => {
      if (tier !== "all" && b.tier !== tier) return false;
      if (city !== "all" && b.city !== city) return false;
      if (billing !== "all" && b.billing_status !== billing) return false;
      if (q) {
        const needle = q.toLowerCase();
        return (
          b.name.toLowerCase().includes(needle) ||
          b.whatsapp_number.includes(needle) ||
          b.id.toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [salons.data, q, tier, city, billing]);

  return (
    <TooltipProvider delayDuration={200}>
      <Card className="border shadow-none">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-56">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, ID or WhatsApp number"
                className="pl-9"
              />
            </div>
            <Select value={tier} onValueChange={(v) => setTier(v as Tier | "all")}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="business">Business</SelectItem>
              </SelectContent>
            </Select>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="City" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={billing} onValueChange={(v) => setBilling(v as BillingStatus | "all")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Billing" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All billing</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="grace_period">Grace period</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setOpenAdd(true)} className="ml-auto">
              <Plus className="size-4" /> Add salon
            </Button>
          </div>

          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Salon</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Messages / mo</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salons.isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      No salons match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {b.id.slice(0, 8)}…
                        </div>
                      </TableCell>
                      <TableCell>
                        <TierBadge tier={b.tier} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">+{b.whatsapp_number}</TableCell>
                      <TableCell>{b.city ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {(b.messages_month ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={b.billing_status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {b.billing_status === "suspended" ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                {/* span wrapper so the tooltip still fires on a disabled control */}
                                <span className="inline-flex">
                                  <Switch checked={false} disabled />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Reactivate requires payment — cannot manually re-enable while
                                suspended.
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Switch
                                checked={b.agent_active ?? false}
                                onCheckedChange={(checked) =>
                                  toggleAgent.mutate({ id: b.id, active: checked })
                                }
                                disabled={
                                  toggleAgent.isPending && toggleAgent.variables?.id === b.id
                                }
                              />
                              {b.billing_status === "grace_period" && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className="size-3.5 text-[oklch(0.65_0.16_70)]" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    In grace period — will auto-deactivate if unpaid.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          )}
                          <Button variant="outline" size="sm" onClick={() => setQrFor(b)}>
                            <QrCode className="size-4" /> Pair
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => setDeleteFor(b)}>
                            <Trash2 className="size-4" /> Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AddSalonModal open={openAdd} onOpenChange={setOpenAdd} />
      <QRModal open={!!qrFor} business={qrFor} onOpenChange={(v) => !v && setQrFor(null)} />
      <DeleteSalonModal
        open={!!deleteFor}
        business={deleteFor}
        onOpenChange={(v) => !v && setDeleteFor(null)}
      />
    </TooltipProvider>
  );
}
