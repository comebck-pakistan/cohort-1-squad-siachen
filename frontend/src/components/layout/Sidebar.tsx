import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Store, CreditCard, Settings, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/superadmin", label: "Overview", icon: LayoutDashboard },
  { to: "/superadmin/salons", label: "Salons", icon: Store },
  { to: "/superadmin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/superadmin/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-sidebar-border">
        <div className="size-8 rounded-md bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center">
          <Sparkles className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Recepta</div>
          <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">
            SuperAdmin
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map((it) => {
          const active = it.to === "/superadmin" ? pathname === "/superadmin" : pathname.startsWith(it.to);
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <it.icon className="size-4" />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-sidebar-border text-[11px] text-sidebar-foreground/60">
        halo-backend · v1.0
      </div>
    </aside>
  );
}