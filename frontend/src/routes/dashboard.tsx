import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Sparkles,
  LayoutDashboard,
  MessagesSquare,
  CalendarCheck,
  Bot,
  Plug,
  Settings as SettingsIcon,
  Phone,
  Sun,
  Moon,
  Menu,
  X,
  Play,
  FileText,
  TrendingDown,
  TrendingUp,
  PhoneCall,
  BadgeCheck,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "AI Receptionist — Recepta Control Center" },
      {
        name: "description",
        content: "Live overview of your Recepta receptionist — calls handled, appointments booked, revenue captured and analytics.",
      },
      { property: "og:title", content: "AI Receptionist Dashboard — Recepta" },
      {
        property: "og:description",
        content: "Live overview of Recepta receptionist performance for your salon.",
      },
    ],
  }),
  component: DashboardPage,
});

const nav = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "logs", label: "Call & Chat Logs", icon: MessagesSquare },
  { key: "appointments", label: "Appointments", icon: CalendarCheck },
  { key: "personality", label: "AI Personality", icon: Bot },
  { key: "integrations", label: "Integrations", icon: Plug },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;

function DashboardPage() {
  const [tab, setTab] = useState<(typeof nav)[number]["key"]>("overview");
  const [dark, setDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const salonName = useMemo(() => {
    if (typeof window === "undefined") return "Your Salon";
    try {
      const raw = localStorage.getItem("recepta.onboarding");
      if (raw) return JSON.parse(raw).salonName || "Your Salon";
    } catch {}
    return "Aura Salon & Spa";
  }, []);

  const agentName = useMemo(() => {
    if (typeof window === "undefined") return "Bella";
    try {
      const raw = localStorage.getItem("recepta.onboarding");
      if (raw) return JSON.parse(raw).agentName || "Bella";
    } catch {}
    return "Bella";
  }, []);

  return (
    <div className={cn(dark && "dark")}>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        {/* Sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:static md:flex md:translate-x-0",
            sidebarOpen ? "flex translate-x-0" : "hidden -translate-x-full md:flex",
          )}
        >
          <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
            <Link to="/" className="flex items-center gap-2">
              <div className="grid size-8 place-items-center rounded-lg bg-gradient-luxe text-white shadow-luxe">
                <Sparkles className="size-4" />
              </div>
              <div className="leading-tight">
                <div className="font-display text-sm font-semibold">Recepta</div>
                <div className="text-[9px] uppercase tracking-widest text-sidebar-foreground/60">
                  Receptionist
                </div>
              </div>
            </Link>
            <button
              className="md:hidden text-sidebar-foreground/70"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            >
              <X className="size-5" />
            </button>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {nav.map((it) => {
              const active = tab === it.key;
              return (
                <button
                  key={it.key}
                  onClick={() => {
                    setTab(it.key);
                    setSidebarOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <it.icon className="size-4" />
                  <span>{it.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="border-t border-sidebar-border p-4 text-[11px] text-sidebar-foreground/60">
            Recepta · v1.0
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-card px-5">
            <div className="flex items-center gap-3">
              <button
                className="md:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <Menu className="size-5" />
              </button>
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Welcome back
                </div>
                <div className="font-display text-lg font-semibold leading-tight">{salonName}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 sm:flex">
                <span className="relative grid place-items-center">
                  <span className="size-2 rounded-full bg-primary" />
                  <span className="absolute size-2 animate-ping rounded-full bg-primary/60" />
                </span>
                <span className="text-xs font-semibold text-primary">
                  {agentName} · ACTIVE (Answering Calls)
                </span>
              </div>
              <button
                onClick={() => setDark((d) => !d)}
                className="grid size-9 place-items-center rounded-md border bg-background hover:bg-accent"
                aria-label="Toggle theme"
              >
                {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
              <div className="grid size-9 place-items-center rounded-full bg-gradient-luxe text-xs font-semibold text-white shadow-luxe">
                {salonName.slice(0, 2).toUpperCase()}
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-auto p-6">
            {tab === "overview" && <OverviewTab />}
            {tab === "logs" && <LogsTab />}
            {tab === "appointments" && <ComingSoon title="Appointments" desc="Full appointment calendar & booking manager coming up next." />}
            {tab === "personality" && <ComingSoon title="AI Personality & Prompt Rules" desc="Fine-tune tone, edge cases, escalation triggers, and safety rules." />}
            {tab === "integrations" && <ComingSoon title="Integrations" desc="Square, Fresha, Google Calendar, Mindbody & more." />}
            {tab === "settings" && <ComingSoon title="Settings" desc="Billing, users, and business profile." />}
          </main>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Overview

const chartData = [
  { hour: "9 AM", calls: 6, booked: 4 },
  { hour: "11 AM", calls: 14, booked: 10 },
  { hour: "1 PM", calls: 22, booked: 18 },
  { hour: "3 PM", calls: 28, booked: 22 },
  { hour: "5 PM", calls: 34, booked: 27 },
  { hour: "7 PM", calls: 42, booked: 33 },
  { hour: "9 PM", calls: 30, booked: 24 },
  { hour: "11 PM", calls: 12, booked: 9 },
];

const activity = [
  {
    id: "c1",
    name: "Sana Khan",
    phone: "+92 300 1122334",
    intent: "New Booking",
    status: "Booked",
    duration: "1:42",
    time: "3 min ago",
  },
  {
    id: "c2",
    name: "Hira Malik",
    phone: "+92 321 4567890",
    intent: "Reschedule",
    status: "Booked",
    duration: "0:58",
    time: "12 min ago",
  },
  {
    id: "c3",
    name: "Zara Ahmed",
    phone: "+92 333 9988776",
    intent: "Pricing Inquiry",
    status: "Transferred to Human",
    duration: "2:11",
    time: "28 min ago",
  },
  {
    id: "c4",
    name: "Mehak Riaz",
    phone: "+92 345 2223311",
    intent: "New Booking",
    status: "Booked",
    duration: "1:20",
    time: "1 hr ago",
  },
  {
    id: "c5",
    name: "Unknown Caller",
    phone: "+92 311 5556677",
    intent: "New Booking",
    status: "Booked",
    duration: "1:05",
    time: "2 hr ago",
  },
];

function OverviewTab() {
  const [open, setOpen] = useState<(typeof activity)[number] | null>(null);
  const metrics = [
    { label: "Total Calls Handled", value: "284", trend: "+18%", up: true, icon: PhoneCall },
    { label: "Appointments Booked by AI", value: "142", trend: "+22%", up: true, icon: CalendarCheck },
    { label: "Revenue Captured After-Hours", value: "Rs. 8,45,000", trend: "+31%", up: true, icon: TrendingUp },
    { label: "Missed Call Rate", value: "-94%", trend: "vs last month", up: false, icon: TrendingDown, danger: false },
  ];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <m.icon className="size-5" />
              </div>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                m.up ? "bg-success-soft text-success" : "bg-rose-gold-soft text-[color:var(--rose-gold)]",
              )}>
                {m.trend}
              </span>
            </div>
            <div className="mt-4 font-display text-3xl font-semibold tracking-tight">{m.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Analytics</div>
            <h3 className="mt-1 font-display text-xl font-semibold">Peak Call Hours vs. AI Auto-Bookings</h3>
            <p className="text-xs text-muted-foreground">Last 7 days · hourly average</p>
          </div>
          <Badge className="bg-primary/10 text-primary">Live</Badge>
        </div>
        <div className="mt-6 h-72 w-full">
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{ left: -20, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-emerald-glow)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-emerald-glow)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bookedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-rose-gold)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--color-rose-gold)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="hour" stroke="var(--color-muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="calls"
                name="Calls"
                stroke="var(--color-emerald-glow)"
                strokeWidth={2}
                fill="url(#callsFill)"
              />
              <Area
                type="monotone"
                dataKey="booked"
                name="AI Bookings"
                stroke="var(--color-rose-gold)"
                strokeWidth={2}
                fill="url(#bookedFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent activity */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-6">
          <div>
            <h3 className="font-display text-xl font-semibold">Recent Call Activity</h3>
            <p className="text-xs text-muted-foreground">Live transcripts from your AI receptionist</p>
          </div>
          <Button variant="outline" size="sm" className="rounded-full">View all</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Caller</TableHead>
              <TableHead className="hidden md:table-cell">Intent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Duration</TableHead>
              <TableHead className="hidden lg:table-cell">Time</TableHead>
              <TableHead className="text-right">Transcript</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activity.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.phone}</div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="outline" className="rounded-full">{a.intent}</Badge>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      a.status === "Booked"
                        ? "bg-success-soft text-success"
                        : "bg-warning-soft text-warning-foreground",
                    )}
                  >
                    {a.status === "Booked" ? <BadgeCheck className="size-3" /> : <Phone className="size-3" />}
                    {a.status}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{a.duration}</TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{a.time}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-primary hover:bg-primary/10"
                    onClick={() => setOpen(a)}
                  >
                    <Play className="size-3.5" />
                    Listen
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">Call Transcript</DialogTitle>
            <DialogDescription>
              {open?.name} · {open?.phone} · {open?.time}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-4">
            <button className="flex w-full items-center gap-3 rounded-lg bg-gradient-luxe px-4 py-3 text-sm font-semibold text-white shadow-luxe">
              <Play className="size-4" />
              Play audio · {open?.duration}
            </button>
          </div>
          <div className="max-h-96 space-y-3 overflow-y-auto text-sm">
            <TranscriptLine who="AI">Assalam-o-Alaikum, aap ne {`{{salon}}`} ko call kiya hai — main Bella hoon. Aap ki kya khidmat kar sakti hoon?</TranscriptLine>
            <TranscriptLine who="Caller">Kal shaam ko HydraFacial ka appointment chahiye tha.</TranscriptLine>
            <TranscriptLine who="AI">Zaroor! Kal 3:00 PM aur 5:30 PM available hai. Kaunsa suit karega?</TranscriptLine>
            <TranscriptLine who="Caller">5:30 PM chalega.</TranscriptLine>
            <TranscriptLine who="AI">Perfect. Aap ka naam?</TranscriptLine>
            <TranscriptLine who="Caller">Sana Khan.</TranscriptLine>
            <TranscriptLine who="AI">Booked, Sana. Kya Blow-dry bhi add karna chahengi? Sirf Rs. 2,000 mein.</TranscriptLine>
            <TranscriptLine who="Caller">Haan add kar dein.</TranscriptLine>
            <TranscriptLine who="AI">Done! Kal 5:30 PM · HydraFacial + Blow-dry · Rs. 8,500. Confirmation WhatsApp par bhej diya hai.</TranscriptLine>
          </div>
          <div className="flex items-center justify-end gap-2 border-t pt-3">
            <Button variant="outline" size="sm" className="rounded-full">
              <FileText className="size-4" /> Export
            </Button>
            <Button size="sm" className="rounded-full bg-gradient-luxe text-white">View booking</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TranscriptLine({ who, children }: { who: "AI" | "Caller"; children: React.ReactNode }) {
  return (
    <div className={cn("flex gap-2", who === "AI" ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px]",
          who === "AI" ? "bg-primary/10 text-foreground" : "bg-muted",
        )}
      >
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {who}
        </div>
        {children}
      </div>
    </div>
  );
}

function LogsTab() {
  return <ComingSoon title="Call & Chat Logs" desc="Full searchable transcripts for every call and WhatsApp message." />;
}

function ComingSoon({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md rounded-2xl border border-dashed border-border bg-card p-10 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
          <Sparkles className="size-5" />
        </div>
        <h3 className="mt-5 font-display text-2xl font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
