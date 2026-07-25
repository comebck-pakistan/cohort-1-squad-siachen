import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "sonner";
import { api, qk } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Business } from "@/types";

interface Props {
  open: boolean;
  business: Business | null;
  onOpenChange: (v: boolean) => void;
}

export function DeleteSalonModal({ open, business, onOpenChange }: Props) {
  const qc = useQueryClient();

  const del = useMutation({
    mutationFn: () => api.deleteSalon(business!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.salons });
      toast.success("Salon deleted");
      onOpenChange(false);
    },
    onError: () => toast.error("Failed to delete salon"),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete salon</AlertDialogTitle>
          <AlertDialogDescription>
            {business ? `Delete ${business.name}? This cannot be undone.` : "—"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              del.mutate();
            }}
            disabled={del.isPending}
            className={cn(buttonVariants({ variant: "destructive" }))}
          >
            {del.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
