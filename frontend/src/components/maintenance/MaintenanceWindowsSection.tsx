// ---------------------------------------------------------------------------
// MaintenanceWindowsSection.tsx — list of open + recent windows with
// edit/disable actions. Top button: "Enable for a salon" opens the dialog
// in salon mode.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, PowerOff, Plus } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

import { api, qk } from "@/lib/api";
import { formatRemainingTime, isoToLocalDateTime } from "@/lib/maintenance-helpers";
import type { Business, MaintenanceWindowRow } from "@/types";

import { EnableMaintenanceDialog } from "./EnableMaintenanceDialog";
import { EditWindowDialog } from "./EditWindowDialog";

interface Props {
  salons: Business[];
}

function salonNameLookup(salons: Business[]): (id: string | null) => string {
  const map = new Map(salons.map((s) => [s.id, s.name] as const));
  return (id) => (id ? map.get(id) ?? id.slice(0, 8) : "—");
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function MaintenanceWindowsSection({ salons }: Props) {
  const qc = useQueryClient();
  const [enableOpen, setEnableOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceWindowRow | null>(null);

  const windowsQ = useQuery({
    queryKey: qk.maintenanceWindows({ openOnly: false }),
    queryFn: () =>
      api.getMaintenanceWindows({ openOnly: false, limit: 100 }),
    refetchInterval: 30_000,
  });

  const disableMut = useMutation({
    mutationFn: (w: MaintenanceWindowRow) => {
      if (w.scope === "global") return api.disableGlobalMaintenance();
      return api.disableSalonMaintenance(w.salon_id!);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      toast.success("Window disabled");
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const nameOf = salonNameLookup(salons);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Windows</CardTitle>
            <p className="text-xs text-muted-foreground">
              Open and recently-closed maintenance windows.
            </p>
          </div>
          <Button onClick={() => setEnableOpen(true)}>
            <Plus className="size-4" />
            Enable for a salon
          </Button>
        </CardHeader>
        <CardContent>
          {windowsQ.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {windowsQ.isError && (
            <p className="text-sm text-destructive">
              Failed to load windows: {(windowsQ.error as Error).message}
            </p>
          )}
          {windowsQ.data && windowsQ.data.windows.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No maintenance windows yet.
            </div>
          )}
          {windowsQ.data && windowsQ.data.windows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Ends in</TableHead>
                  <TableHead>Cooldown</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {windowsQ.data.windows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {w.scope}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {w.scope === "global"
                        ? "All salons"
                        : nameOf(w.salon_id)}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="text-sm line-clamp-1 text-muted-foreground">
                        {w.message}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {w.enabled ? formatRemainingTime(w.ends_at) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {w.cooldown_minutes}m
                    </TableCell>
                    <TableCell>
                      {w.enabled ? (
                        <Badge className="bg-success-soft text-[oklch(0.42_0.10_195)] border-transparent">
                          Open
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Closed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(w)}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                      {w.enabled && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => disableMut.mutate(w)}
                          disabled={disableMut.isPending}
                        >
                          {disableMut.isPending &&
                          disableMut.variables?.id === w.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <PowerOff className="size-3.5" />
                          )}
                          Disable
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {windowsQ.data && windowsQ.data.windows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {windowsQ.data.windows.length} window
              {windowsQ.data.windows.length === 1 ? "" : "s"}. Closed windows
              are auto-cleaned after {formatTimestamp(
                windowsQ.data.windows.at(-1)?.closed_at ?? new Date().toISOString(),
              )}.
            </p>
          )}
        </CardContent>
      </Card>

      <EnableMaintenanceDialog
        open={enableOpen}
        onOpenChange={setEnableOpen}
        mode="salon"
        salons={salons}
      />

      {editing && (
        <EditWindowDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          window={editing}
        />
      )}
    </>
  );
}
