import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { TenantShell } from "@/components/tenant/TenantShell";
import { useAuth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Auth gate for /salon-portal/* routes.
//
// Pattern mirrored from /superadmin (superadmin.tsx:30-38). Before Wave 6
// the salon-portal layout had no auth check — visiting /salon-portal while
// signed out just rendered an empty TenantShell. Now a signed-out visitor
// is bounced to /login before any child route mounts, so direct-linking
// any /salon-portal/* URL goes through the login flow first.
// ---------------------------------------------------------------------------

function SalonPortalGate() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.isReady && !auth.isAuthenticated) {
      void navigate({ to: "/login" });
    }
  }, [auth.isReady, auth.isAuthenticated, navigate]);

  // While the boot-time session probe is in flight OR we just bounced,
  // render a centered spinner so the route doesn't flash the dashboard
  // before the redirect lands.
  if (!auth.isReady || !auth.isAuthenticated) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return <TenantShell />;
}

export const Route = createFileRoute("/salon-portal")({
  head: () => ({
    meta: [
      { title: "Salon Admin Portal — Recepta" },
      { name: "description", content: "Tenant portal for salon owners to manage AI agent, bookings, and staff." },
      { property: "og:title", content: "Salon Admin Portal — Recepta" },
      { property: "og:description", content: "Manage AI agent, WhatsApp inbox, and business rules." },
    ],
  }),
  component: SalonPortalGate,
});
