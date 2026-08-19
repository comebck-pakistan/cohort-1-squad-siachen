import { Bell, LogOut, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials, useAuth } from "@/lib/auth";
import { MaintenanceBadge } from "@/components/maintenance/MaintenanceBadge";
import { toast } from "sonner";

const titles: Record<string, { title: string; subtitle: string }> = {
  "/superadmin": { title: "Overview", subtitle: "Global operational health across all tenants" },
  "/superadmin/salons": { title: "Salons", subtitle: "Directory of tenant salon instances" },
  "/superadmin/subscriptions": { title: "Subscriptions", subtitle: "Revenue analytics and payment logs" },
  "/superadmin/payments": { title: "Payment approvals", subtitle: "Review and approve pending payment submissions" },
  "/superadmin/maintenance": { title: "Maintenance", subtitle: "System mode controls — pause customer-facing AI" },
  "/superadmin/notifications": { title: "Notifications", subtitle: "Push company-wide announcements to every dashboard" },
  "/superadmin/settings": { title: "Settings", subtitle: "Tier limits and AI platform safety rules" },
};

export function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const meta = titles[pathname] ?? titles["/superadmin"];
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    toast.success("Signed out");
    navigate({ to: "/superadmin/login" });
  }

  return (
    <header className="h-16 border-b bg-card px-6 flex items-center justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{meta.title}</h1>
        <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        <MaintenanceBadge />
        <div className="relative hidden sm:block">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search salons, IDs, numbers…" className="pl-9 w-72 bg-background" />
        </div>
        <button className="relative size-9 grid place-items-center rounded-md border bg-background hover:bg-accent">
          <Bell className="size-4" />
          <span className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="size-9 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-semibold hover:opacity-90"
              aria-label="Account menu"
            >
              {user ? initials(user.name) : "SA"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {user && (
              <>
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground font-normal">
                    {user.email}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                    {user.role}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}