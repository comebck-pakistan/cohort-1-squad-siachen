// ---------------------------------------------------------------------------
// MaintenanceAuditSection.tsx — append-only audit log with action filter.
//
// Filters: action (Select). Audit limit is 100. Polls every 30s. Action
// labels follow actionLabel() in maintenance-helpers; tone is from
// actionBadgeClass().
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { api, qk } from "@/lib/api";
import {
  actionBadgeClass,
  actionLabel,
  truncateActor,
} from "@/lib/maintenance-helpers";
import type { MaintenanceAuditAction } from "@/types";

const ACTION_OPTIONS: Array<MaintenanceAuditAction | "all"> = [
  "all",
  "enabled",
  "disabled",
  "updated",
  "expired",
  "response_sent",
  "response_suppressed",
  "lookup_failed",
];

export function MaintenanceAuditSection() {
  const [actionFilter, setActionFilter] = useState<MaintenanceAuditAction | "all">(
    "all",
  );

  const auditQ = useQuery({
    queryKey: qk.maintenanceAudit({
      action: actionFilter === "all" ? undefined : actionFilter,
    }),
    queryFn: () =>
      api.getMaintenanceAudit({
        action: actionFilter === "all" ? undefined : actionFilter,
        limit: 100,
      }),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Audit log</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every toggle, expiry, lookup failure, and reply decision.
          </p>
        </div>
        <div className="w-48">
          <Select
            value={actionFilter}
            onValueChange={(v) =>
              setActionFilter(v as MaintenanceAuditAction | "all")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a === "all" ? "All actions" : actionLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {auditQ.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {auditQ.isError && (
          <p className="text-sm text-destructive">
            Failed to load audit log: {(auditQ.error as Error).message}
          </p>
        )}
        {auditQ.data && auditQ.data.entries.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No audit entries yet.
          </div>
        )}
        {auditQ.data && auditQ.data.entries.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditQ.data.entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums text-xs font-mono whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge className={actionBadgeClass(e.action)}>
                      {actionLabel(e.action)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {e.scope ? (
                      <Badge variant="outline" className="capitalize">
                        {e.scope}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateActor(e.actor_id)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {e.reason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
