import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  CalendarCheck,
  MessagesSquare,
  Sparkles,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Smartphone,
  ArrowRight,
  MessageCircle,
} from "lucide-react";
import { api, qk } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";

// ---------------------------------------------------------------------------
// /salon-portal — Overview
//
// All KPIs, the daily volume chart, and the recent-activity feed come from
// GET /api/business/:id/dashboard-stats (Phase 1 backend endpoint). The
// intent-distribution chart is empty for now because the backend doesn't
// tag intents yet — we render a placeholder explaining that.
//
// Loading state: per-card Skeleton. Empty state: "—" instead of zeros so
// fresh signups don't see fake numbers.
// ---------------------------------------------------------------------------

const intentColors: Record<string, string> = {
  Bookings: "oklch(0.55 0.11 195)",
  Pricing: "oklch(0.72 0.15 70)",
  "Timings/Location": "oklch(0.72 0.10 195)",
  Escalations: "oklch(0.6 0.22 27)",
};

const fmtPKR = (n: number) =>
  n >= 1000 ? `PKR ${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `PKR ${n}`;
const fmtCount = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${n}`;
const fmtTime = (iso: string) => {
  const t = new Date(iso);
  const min = Math.round((Date.now() - t.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
};

export function TenantOverview() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";

  const stats = useQuery({
    queryKey: businessId
      ? qk.dashboardStats(businessId)
      : ["dashboard-stats", "none"],
    queryFn: () => api.dashboardStats(businessId),
    enabled: !!businessId,
    staleTime: 60_000,
  });

  const k = stats.data?.kpis;
  const hasAnyKpi =
    k &&
    (k.bookings_handled > 0 ||
      k.conversations_processed > 0 ||
      k.resolution_rate > 0 ||
      k.revenue_pkr > 0);

  const kpis = [
    {
      label: "Bookings Handled by AI",
      value: k ? fmtCount(k.bookings_handled) : "—",
      sub: "this month",
      icon: CalendarCheck,
    },
    {
      label: "Conversations Processed",
      value: k ? fmtCount(k.conversations_processed) : "—",
      sub: "this month",
      icon: MessagesSquare,
    },
    {
      label: "AI Resolution Rate",
      value: k ? `${k.resolution_rate}%` : "—",
      sub: "of bookings",
      icon: Sparkles,
    },
    {
      label: "Revenue via Agent",
      value: k ? fmtPKR(k.revenue_pkr) : "—",
      sub: "completed bookings",
      icon: Wallet,
    },
  ];

  const hourly = stats.data?.hourly ?? [];
  const intents = stats.data?.intents ?? [];
  const feed = stats.data?.feed ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          How your AI agent is performing across WhatsApp today.
        </p>
      </div>

      {/* Connect WhatsApp CTA — primary onboarding entry point */}
      <Card className="border-primary/20 bg-primary/5 shadow-none">
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shrink-0">
              <Smartphone className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="font-medium">Connect your WhatsApp</div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Pair your salon's WhatsApp number with the Recepta AI receptionist.
                Customers who message your number get an instant AI reply.
              </p>
            </div>
          </div>
          <Button asChild className="shrink-0">
            <Link to="/salon-portal/onboarding">
              Connect WhatsApp
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="border shadow-none bg-white">
                <CardContent className="p-5 space-y-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-7 w-20" />
                  <Skeleton className="h-3 w-24" />
                </CardContent>
              </Card>
            ))
          : kpis.map((k) => (
              <Card key={k.label} className="border shadow-none bg-white">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {k.label}
                      </div>
                      <div className="mt-1 text-2xl font-semibold tracking-tight">
                        {k.value}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {k.sub}
                      </div>
                    </div>
                    <div className="size-9 rounded-md bg-primary/10 text-primary grid place-items-center">
                      <k.icon className="size-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border shadow-none bg-white lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily Conversation Volume</CardTitle>
            <p className="text-xs text-muted-foreground">
              Peak hours help you plan staff coverage.
            </p>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-64">
              {stats.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : hourly.length === 0 ? (
                <div className="h-full grid place-items-center text-sm text-muted-foreground text-center px-6">
                  No conversations today yet. Once customers start messaging,
                  their volume shows up here.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 70)" />
                    <XAxis dataKey="h" stroke="oklch(0.5 0.02 40)" fontSize={12} />
                    <YAxis stroke="oklch(0.5 0.02 40)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "white",
                        border: "1px solid oklch(0.92 0.01 70)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="c" fill="oklch(0.55 0.11 195)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-none bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Intent Distribution</CardTitle>
            <p className="text-xs text-muted-foreground">
              What customers ask most.
            </p>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-64">
              {stats.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : intents.length === 0 ? (
                <div className="h-full grid place-items-center text-sm text-muted-foreground text-center px-6">
                  We start tagging intents once your agent has handled a few
                  conversations — they show up here.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={intents}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {intents.map((e) => (
                        <Cell key={e.name} fill={e.color || intentColors[e.name] || "#999"} />
                      ))}
                    </Pie>
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "white",
                        border: "1px solid oklch(0.92 0.01 70)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity feed */}
      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent AI Actions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stats.isLoading ? (
            <ul className="divide-y">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-4">
                  <Skeleton className="size-8 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </li>
              ))}
            </ul>
          ) : feed.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              <MessageCircle className="size-8 mx-auto mb-2 opacity-50" />
              No agent activity yet. The latest 10 messages will appear here.
            </div>
          ) : (
            <ul className="divide-y">
              {feed.map((f, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-4">
                  <div
                    className={
                      f.tone === "success"
                        ? "size-8 rounded-md grid place-items-center shrink-0 bg-success-soft text-[oklch(0.42_0.10_195)]"
                        : f.tone === "warn"
                          ? "size-8 rounded-md grid place-items-center shrink-0 bg-warning-soft text-[oklch(0.35_0.1_70)]"
                          : "size-8 rounded-md grid place-items-center shrink-0 bg-muted text-muted-foreground"
                    }
                  >
                    <MessageCircle className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 text-sm">{f.text}</div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {fmtTime(f.time)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
