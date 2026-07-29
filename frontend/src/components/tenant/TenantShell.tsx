import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";
import {
  LayoutDashboard,
  MessagesSquare,
  CalendarDays,
  Scissors,
  Users,
  Megaphone,
  Bot,
  AlertTriangle,
  Building2,
  ChevronDown,
  CircleDot,
  Sparkles,
  LogOut,
  Menu,
  Smartphone,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  badge?: number;
};

const nav: NavItem[] = [
  { to: "/salon-portal", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/salon-portal/inbox", label: "Conversations", icon: MessagesSquare },
  { to: "/salon-portal/escalations", label: "Edge Cases", icon: AlertTriangle, badge: 3 },
  { to: "/salon-portal/business", label: "Services & Staff", icon: Scissors },
  { to: "/salon-portal/ai-rules", label: "Agent Rules", icon: Bot },
  { to: "/salon-portal/onboarding", label: "Connect WhatsApp", icon: Smartphone },
];

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Single-salon owners see one salon card; the dropdown becomes a label.
// We still accept an array so multi-salon owners can be added later without
// reshaping the JSX.
const salonsFromIdentity = (id: string, name: string, city: string) => [
  {
    id: id || "self",
    name: name || "Your salon",
    branch: city || "",
  },
];

const roleLabel = (role: string | undefined): string => {
  switch (role) {
    case "superadmin":
      return "Superadmin";
    case "business_owner":
      return "Owner";
    case "staff":
      return "Staff";
    default:
      return "Owner";
  }
};

export function TenantShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const tenant = useTenantBusinessId();
  const [agentOnline, setAgentOnline] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Build a single-salon list from the identity so the existing JSX works
  // without reshaping. Multi-salon support can plug in here later.
  const identity = tenant.data;
  const salons = identity
    ? salonsFromIdentity(
        identity.businessId,
        identity.businessName,
        identity.businessCity,
      )
    : [];
  const [salon, setSalon] = useState(salons[0] ?? { id: "self", name: "Your salon", branch: "" });

  // When the identity loads (or changes after a login), snap the active
  // salon to the user's real one. Multi-salon users can still switch via
  // the dropdown — only the default selection is forced.
  useEffect(() => {
    if (salons[0]) setSalon(salons[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.businessId]);

  const ownerName = identity?.fullName || identity?.email || "Owner";
  const ownerEmail = identity?.email || "";
  const ownerRole = roleLabel(identity?.role);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Brief loading shell while /api/auth/me resolves. Without this the user
  // sees a "Your salon" placeholder flash before the real identity lands.
  if (tenant.isLoading && !identity) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[oklch(0.985_0.005_180)]">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Skeleton className="size-4 rounded-full" />
          Loading your salon…
        </div>
      </div>
    );
  }

  if (tenant.isError && !identity) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[oklch(0.985_0.005_180)] p-6">
        <div className="max-w-md text-center">
          <div className="text-base font-medium">Could not load your salon</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {String(tenant.error?.message || "Unknown error")}
          </div>
          <button
            type="button"
            className="mt-4 inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted"
            onClick={() => tenant.refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  function handleSignOut() {
    try {
      localStorage.removeItem("recepta.owner.session");
    } catch {}
    toast.success("Signed out");
    navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen w-full bg-[oklch(0.985_0.005_180)] text-foreground">
      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-white transition-transform md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between border-b p-5">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-base font-semibold text-primary">Recepta</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Owner Dashboard
              </div>
            </div>
          </Link>
          <button
            className="md:hidden text-muted-foreground"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Salon switcher */}
        <div className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60 transition-colors text-left">
                <div className="size-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                  <Building2 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{salon.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{salon.branch}</div>
                </div>
                <ChevronDown className="size-4 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="start">
              <DropdownMenuLabel>Switch branch</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {salons.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => setSalon(s)}>
                  <div>
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.branch}</div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {nav.map((it) => {
            const active = it.exact
              ? pathname === it.to
              : pathname.startsWith(it.to);
            return (
              <Link
                key={it.to}
                to={it.to as string}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-foreground/70 hover:bg-muted",
                )}
              >
                <it.icon className="size-4" />
                <span className="flex-1">{it.label}</span>
                {it.badge ? (
                  <Badge
                    className={cn(
                      "h-5 min-w-5 px-1.5 text-[10px] border-transparent",
                      active
                        ? "bg-white/20 text-primary-foreground"
                        : "bg-destructive text-destructive-foreground",
                    )}
                  >
                    {it.badge}
                  </Badge>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Coming-soon quick links (visual parity with reference) */}
        <div className="px-3 pb-3">
          <div className="rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground space-y-1.5">
            <div className="flex items-center gap-2 opacity-80"><CalendarDays className="size-3.5" /> Bookings · coming soon</div>
            <div className="flex items-center gap-2 opacity-80"><Users className="size-3.5" /> Staff availability · coming soon</div>
            <div className="flex items-center gap-2 opacity-80"><Megaphone className="size-3.5" /> Promotions · coming soon</div>
          </div>
        </div>

        {/* Owner card */}
        <div className="border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60 transition-colors text-left">
                <div className="size-9 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-semibold shrink-0">
                  {initialsOf(ownerName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{ownerName}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{ownerRole}</div>
                </div>
                <ChevronDown className="size-4 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel>
                <div className="text-sm font-medium">{ownerName}</div>
                <div className="text-xs text-muted-foreground font-normal">{ownerEmail}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-white border-b px-4 md:px-6 flex items-center justify-between gap-4">
          <button
            className="md:hidden -ml-1 grid size-9 place-items-center rounded-md hover:bg-muted"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>

          <div className="hidden md:block text-sm text-muted-foreground">
            Good morning, <span className="font-medium text-foreground">{ownerName.split(" ")[0]}</span>.
            Your AI agent is currently {agentOnline ? "online" : "paused"}.
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setAgentOnline((v) => !v)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                agentOnline
                  ? "bg-primary text-primary-foreground border-transparent hover:opacity-90"
                  : "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
              )}
            >
              <CircleDot className="size-3" />
              {agentOnline ? "Agent Live" : "Agent Paused"}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="size-9 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-semibold hover:opacity-90"
                  aria-label="Account menu"
                >
                  {initialsOf(ownerName)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{ownerName}</div>
                  <div className="text-xs text-muted-foreground font-normal">{ownerEmail}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
