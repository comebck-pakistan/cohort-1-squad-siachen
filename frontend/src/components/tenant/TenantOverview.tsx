import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Bot,
  UserCog,
  CheckCircle2,
} from "lucide-react";

const kpis = [
  { label: "Bookings Handled by AI", value: "184", delta: "+18%", up: true, sub: "vs last month", icon: CalendarCheck },
  { label: "Conversations Processed", value: "1,247", delta: "+22%", up: true, sub: "vs last month", icon: MessagesSquare },
  { label: "AI Resolution Rate", value: "86%", delta: "+4%", up: true, sub: "no human needed", icon: Sparkles },
  { label: "Revenue via Agent", value: "PKR 412,000", delta: "-3%", up: false, sub: "est. this month", icon: Wallet },
];

const hourly = [
  { h: "8a", c: 4 }, { h: "10a", c: 9 }, { h: "12p", c: 18 },
  { h: "2p", c: 22 }, { h: "4p", c: 34 }, { h: "6p", c: 42 },
  { h: "8p", c: 28 }, { h: "10p", c: 12 },
];

const intents = [
  { name: "Bookings", value: 60, color: "oklch(0.6 0.12 175)" },
  { name: "Pricing", value: 25, color: "oklch(0.72 0.15 70)" },
  { name: "Timings/Location", value: 10, color: "oklch(0.65 0.14 220)" },
  { name: "Escalations", value: 5, color: "oklch(0.6 0.22 27)" },
];

const feed = [
  { icon: CalendarCheck, text: "Booked haircut for Ayesha K. — Sat 4:00 PM with Ali", time: "2m ago", tone: "success" as const },
  { icon: Bot, text: "AI answered pricing question for +9230012345 (Facial menu)", time: "8m ago", tone: "muted" as const },
  { icon: UserCog, text: "Escalated to manager — complaint about last visit", time: "22m ago", tone: "warn" as const },
  { icon: CheckCircle2, text: "Booking confirmed & payment link sent (PKR 3,500)", time: "41m ago", tone: "success" as const },
  { icon: CalendarCheck, text: "Cancelled: Nail art appointment for Sana R.", time: "1h ago", tone: "muted" as const },
];

export function TenantOverview() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          How your AI agent is performing across WhatsApp today.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label} className="border shadow-none bg-white">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {k.label}
                  </div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight">{k.value}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs">
                    <span
                      className={
                        k.up
                          ? "inline-flex items-center gap-0.5 text-[oklch(0.4_0.15_145)]"
                          : "inline-flex items-center gap-0.5 text-[oklch(0.5_0.18_27)]"
                      }
                    >
                      {k.up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                      {k.delta}
                    </span>
                    <span className="text-muted-foreground">{k.sub}</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border shadow-none bg-white lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily Conversation Volume</CardTitle>
            <p className="text-xs text-muted-foreground">Peak hours help you plan staff coverage.</p>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 220)" />
                  <XAxis dataKey="h" stroke="oklch(0.5 0.02 250)" fontSize={12} />
                  <YAxis stroke="oklch(0.5 0.02 250)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "white",
                      border: "1px solid oklch(0.92 0.008 220)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="c" fill="oklch(0.6 0.12 175)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-none bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Intent Distribution</CardTitle>
            <p className="text-xs text-muted-foreground">What customers ask most.</p>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-64">
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
                      <Cell key={e.name} fill={e.color} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: "white",
                      border: "1px solid oklch(0.92 0.008 220)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent AI Actions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {feed.map((f, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-4">
                <div
                  className={
                    f.tone === "success"
                      ? "size-8 rounded-md grid place-items-center shrink-0 bg-success-soft text-[oklch(0.35_0.12_145)]"
                      : f.tone === "warn"
                      ? "size-8 rounded-md grid place-items-center shrink-0 bg-warning-soft text-[oklch(0.35_0.1_70)]"
                      : "size-8 rounded-md grid place-items-center shrink-0 bg-muted text-muted-foreground"
                  }
                >
                  <f.icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1 text-sm">{f.text}</div>
                <div className="text-xs text-muted-foreground shrink-0">{f.time}</div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}