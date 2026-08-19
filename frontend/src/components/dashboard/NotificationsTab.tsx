// ---------------------------------------------------------------------------
// NotificationsTab.tsx — superadmin surface to view, compose, edit, and
// archive global notifications. Mirrors PaymentApprovalsTab.tsx for parity.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Pencil, Archive, Megaphone } from "lucide-react";
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
import type { NotificationRow, NotificationSeverity } from "@/types";

import { ComposeNotificationDialog } from "@/components/notifications/ComposeNotificationDialog";

const SEVERITY_TONE: Record<NotificationSeverity, string> = {
  info: "bg-info-soft text-[oklch(0.42_0.10_195)] border-transparent",
  warning: "bg-warning-soft text-[oklch(0.4_0.12_85)] border-transparent",
  critical: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
};

function statusTone(active: boolean): string {
  return active
    ? "bg-success-soft text-[oklch(0.42_0.10_195)] border-transparent"
    : "bg-muted text-muted-foreground border-transparent";
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function NotificationsTab() {
  const qc = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationRow | null>(null);

  const list = useQuery({
    queryKey: qk.notificationsList,
    queryFn: () => api.listNotifications(),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.archiveNotification(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Notification archived");
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Global notifications</CardTitle>
            <p className="text-xs text-muted-foreground">
              Push announcements to every logged-in dashboard. Renders
              nothing when no notification is active.
            </p>
          </div>
          <Button onClick={() => setComposeOpen(true)}>
            <Plus className="size-4" />
            Compose new
          </Button>
        </CardHeader>
        <CardContent>
          {list.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {list.isError && (
            <p className="text-sm text-destructive">
              Failed to load notifications: {(list.error as Error).message}
            </p>
          )}
          {list.data && list.data.notifications.length === 0 && (
            <div className="p-12 text-center">
              <Megaphone className="size-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No notifications yet. Click "Compose new" to create one.
              </p>
            </div>
          )}
          {list.data && list.data.notifications.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Body</TableHead>
                  <TableHead>Ends at</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.notifications.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell>
                      <Badge className={`${SEVERITY_TONE[n.severity]} capitalize`}>
                        {n.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{n.title}</TableCell>
                    <TableCell className="max-w-xs">
                      <span className="text-sm line-clamp-1 text-muted-foreground">
                        {n.body}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {formatTime(n.ends_at)}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusTone(n.active)}>
                        {n.active ? "Active" : "Archived"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(n)}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                      {n.active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => archiveMut.mutate(n.id)}
                          disabled={archiveMut.isPending}
                        >
                          {archiveMut.isPending &&
                          archiveMut.variables === n.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Archive className="size-3.5" />
                          )}
                          Archive
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ComposeNotificationDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        mode="create"
      />
      {editing && (
        <ComposeNotificationDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          mode="edit"
          initial={editing}
        />
      )}
    </>
  );
}
