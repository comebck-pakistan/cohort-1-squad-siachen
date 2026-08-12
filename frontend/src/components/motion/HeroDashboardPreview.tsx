// ---------------------------------------------------------------------------
// HeroDashboardPreview — read-only, self-contained preview of the Recepta
// Owner Dashboard, used in the marketing hero.
//
// Why not just mount <TenantShell/> + <TenantOverview/>? The real dashboard
// pulls identity from /api/auth/me, KPIs from /api/business/:id/dashboard-stats,
// subscription state, the agent-pause hook, etc. — none of which exists for a
// logged-out visitor. Per the brief, we mirror the visual structure and use
// the same Card / chart / icon primitives + teal tokens, but feed it
// deterministic demo data so the showcase is safe to render publicly.
//
// Phase 2 (Wave 11 checkpoint 2) adds a quiet, deterministic demo loop that
// tells the visitor's eye the product story without clicking:
//
//   1. Customer sends a WhatsApp message   (gray bubble, channel color)
//   2. Recepta replies                      (teal bubble, brand layer)
//   3. Recepta books the appointment        (✓ pill, brand color)
//   4. Dashboard records it in Recent AI    (new row animates into feed)
//   5. Reset, then a different scenario     (cycle continues)
//
// Everything is deterministic (no random, no API), respects
// prefers-reduced-motion (final state shown statically), and stays subtle:
// fade + small slide only — no bounce, no neon, no large floating bubbles.
// ---------------------------------------------------------------------------

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Bot,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  Scissors,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Deterministic demo data — never fetched, safe for public render.
// Numbers are sized for "busy single-location salon" (not enterprise).
// ---------------------------------------------------------------------------

const DEMO_KPIS = [
  { label: "Bookings handled", value: "128", sub: "by AI this month", icon: CalendarCheck },
  { label: "Conversations", value: "486", sub: "processed this month", icon: MessagesSquare },
  { label: "Resolution rate", value: "94%", sub: "AI handled end-to-end", icon: TrendingUp },
  { label: "Revenue via agent", value: "PKR 184.5k", sub: "from AI bookings", icon: Wallet },
] as const;

const DEMO_HOURLY = [
  { h: "9a", c: 8 },
  { h: "10a", c: 14 },
  { h: "11a", c: 22 },
  { h: "12p", c: 35 },
  { h: "1p", c: 28 },
  { h: "2p", c: 18 },
  { h: "3p", c: 32 },
  { h: "4p", c: 41 },
  { h: "5p", c: 38 },
  { h: "6p", c: 24 },
  { h: "7p", c: 16 },
  { h: "8p", c: 9 },
];

type FeedTone = "success" | "warn" | "default";

interface FeedItem {
  tone: FeedTone;
  text: string;
  time: string;
}

// The 3 "earlier today" entries. The 4th slot is reserved for the live item
// that animates in/out of the feed during the demo cycle.
const DEMO_FEED_BASELINE: FeedItem[] = [
  { tone: "success", text: "Booked · Hira M. · HydraFacial · tomorrow 5:30 PM", time: "8m" },
  { tone: "default", text: "Replied to Ayesha R. about bridal package pricing", time: "24m" },
  { tone: "warn", text: "Escalated · Mehwish I. asked for the manager", time: "1h" },
];

// ---------------------------------------------------------------------------
// Demo loop — 4 scenarios the visitor sees cycle through in order.
// Each scenario has a customer WhatsApp message, the bot's reply, and the
// resulting feed entry. All text is plausible — no fake names from real
// customers.
// ---------------------------------------------------------------------------

interface Scenario {
  customer: string;
  bot: string;
  feed: FeedItem;
}

const SCENARIOS: Scenario[] = [
  {
    customer: "Assalam o Alaikum! Kal 3 PM haircut available hai?",
    bot: "Wa Alaikum Assalam! Ji bilkul. Kal 3:00 PM available hai.",
    feed: {
      tone: "success",
      text: "Booked · Sana K. · Hair Cut · tomorrow 3:00 PM",
      time: "just now",
    },
  },
  {
    customer: "Hi, Saturday bridal makeup ka slot hai?",
    bot: "Hi! Saturday 11 AM ya 2 PM available hai. Konse pasand hai?",
    feed: {
      tone: "success",
      text: "Booked · Fatima T. · Bridal Makeup · Sat 11:00 AM",
      time: "just now",
    },
  },
  {
    customer: "Hair colour ke liye konsi staff best hai?",
    bot: "Zara A. 8 saal experience, ya Sana K. color specialist hai.",
    feed: {
      tone: "default",
      text: "Replied to Hira about Hair Colour specialists",
      time: "just now",
    },
  },
  {
    customer: "Aaj 6 PM threading chahiye please",
    bot: "Aaj 6:00 PM available hai. Book kar dun?",
    feed: {
      tone: "success",
      text: "Booked · Hira M. · Threading · today 6:00 PM",
      time: "just now",
    },
  },
];

// ---------------------------------------------------------------------------
// Phase machine — drives the demo loop.
//
//   IDLE             → brief pause between cycles (overlay + live item hidden)
//   INCOMING         → WhatsApp overlay fades in, customer message appears
//   PROCESSING       → "Recepta is responding…" bubble (subtle, branded)
//   REPLY            → bot reply + ✓ Appointment booked pill
//   DASHBOARD_REACT  → Bookings KPI ticks 128→129 + new feed row appears
//   RESET            → overlay + live item fade out, KPI ticks back to 128
//   (loop back to IDLE)
//
// The DASHBOARD_REACT phase is the most important step in the workflow —
// it makes the visitor's eye see the dashboard actually receiving the
// result of the WhatsApp conversation that just played out above it.
//
// Reduced-motion: useEffect short-circuits, phase freezes on DASHBOARD_REACT
// so the visitor sees the "this just happened" final state statically.
// ---------------------------------------------------------------------------

type DemoPhase =
  | "IDLE"
  | "INCOMING"
  | "PROCESSING"
  | "REPLY"
  | "DASHBOARD_REACT"
  | "RESET";

const PHASE_ORDER: DemoPhase[] = [
  "IDLE",
  "INCOMING",
  "PROCESSING",
  "REPLY",
  "DASHBOARD_REACT",
  "RESET",
];

const PHASE_DURATIONS: Record<DemoPhase, number> = {
  IDLE: 1200,
  INCOMING: 1800,
  PROCESSING: 1500,
  REPLY: 1800,
  DASHBOARD_REACT: 2400,
  RESET: 1000,
};

// Total cycle: 9.7s.

/** Whether the demo has reached (or passed) `target` in the lifecycle. */
function phaseAtLeast(current: DemoPhase, target: DemoPhase): boolean {
  return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target);
}

// ---------------------------------------------------------------------------
// useDemoAnimation — owns the phase machine. Returns the current phase and
// the scenario to show for this cycle. Cycle count drives which scenario
// plays next so visitors see variety on repeat views without randomness.
// ---------------------------------------------------------------------------

function useDemoAnimation(): { phase: DemoPhase; scenario: Scenario; reduced: boolean } {
  const prefersReducedMotion = useReducedMotion();
  const reduced = !!prefersReducedMotion;

  const [phase, setPhase] = useState<DemoPhase>(reduced ? "DASHBOARD_REACT" : "IDLE");
  const [cycleCount, setCycleCount] = useState(0);

  useEffect(() => {
    if (reduced) return undefined;
    const ms = PHASE_DURATIONS[phase];
    const timer = setTimeout(() => {
      setPhase((p) => {
        const i = PHASE_ORDER.indexOf(p);
        const next = PHASE_ORDER[(i + 1) % PHASE_ORDER.length];
        if (next === "IDLE") setCycleCount((c) => c + 1);
        return next;
      });
    }, ms);
    return () => clearTimeout(timer);
  }, [phase, reduced]);

  // When reduced-motion flips on mid-cycle, snap to the final state.
  useEffect(() => {
    if (reduced && phase !== "DASHBOARD_REACT") setPhase("DASHBOARD_REACT");
  }, [reduced, phase]);

  const scenario = SCENARIOS[cycleCount % SCENARIOS.length];
  return { phase, scenario, reduced };
}

// ---------------------------------------------------------------------------
// Outer shell
// ---------------------------------------------------------------------------

export function HeroDashboardPreview() {
  const { phase, scenario, reduced } = useDemoAnimation();
  // The live feed item is shown during DASHBOARD_REACT onward. The phase is
  // also DASHBOARD_REACT in reduced-motion, so static visitors always see
  // this row.
  const liveItem = phaseAtLeast(phase, "DASHBOARD_REACT") ? scenario.feed : null;

  // Bookings counter — this is the "the dashboard actually received the
  // booking" payoff. Animates 128 → 129 during DASHBOARD_REACT, holds at
  // 129 through RESET+IDLE, then resets to 128 just before the next
  // INCOMING so each cycle tells the same story.
  const bookingsMV = useMotionValue(128);
  useEffect(() => {
    if (reduced) return undefined;
    if (phase === "DASHBOARD_REACT") {
      const controls = animate(bookingsMV, bookingsMV.get() + 1, {
        duration: 0.7,
        ease: [0.4, 0, 0.2, 1],
      });
      return () => controls.stop();
    }
    if (phase === "RESET") {
      const controls = animate(bookingsMV, 128, {
        duration: 0.5,
        ease: [0.4, 0, 1, 1],
      });
      return () => controls.stop();
    }
    return undefined;
  }, [phase, bookingsMV, reduced]);

  // Subtle highlight pulse on the Bookings KPI during DASHBOARD_REACT.
  // Signals "this number just changed because of the conversation above".
  const highlightBookings = phase === "DASHBOARD_REACT";

  return (
    <div className="relative">
      {/* Ambient glow under the window — keeps the dashboard feeling like a
          physical object resting on the warm cream page rather than a flat
          panel. Subtle: ~10% opacity primary + accent, large blur. */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-8 -inset-y-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-primary/10 via-accent/40 to-transparent blur-2xl"
      />

      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-white shadow-luxe ring-1 ring-black/[0.03]">
        <WindowChrome reduced={reduced} />
        <div className="grid md:grid-cols-[148px_1fr]">
          <Sidebar />
          <Main liveItem={liveItem} bookingsMV={bookingsMV} highlightBookings={highlightBookings} reduced={reduced} />
        </div>
      </div>

      {/* WhatsApp overlay — sits outside the dashboard window so it can
          float above the chrome. The animation here IS the product story:
          customer message → Recepta reply → booking → dashboard records. */}
      <WhatsAppOverlay phase={phase} scenario={scenario} reduced={reduced} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Window chrome — the "this is a real application" frame. Three dots + a URL
// hint + Agent Live indicator on the right.
// ---------------------------------------------------------------------------

function WindowChrome({ reduced }: { reduced: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-[oklch(0.97_0.008_70)] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[oklch(0.85_0.06_27)]" />
        <span className="size-2.5 rounded-full bg-[oklch(0.85_0.12_75)]" />
        <span className="size-2.5 rounded-full bg-[oklch(0.72_0.10_150)]" />
        <span className="ml-3 hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
          app.recepta.pk / dashboard
        </span>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
        <span className="relative flex size-1.5">
          {/* Two-stage pulse: a motion.span ring scales 1->2.2 while fading
              from 0.6 to 0, paired with a static inner dot. Mirrors the
              pulse-ring keyframes in styles.css but lets us control alpha
              cleanly. Reduced-motion users see just the static dot. */}
          {!reduced && (
            <motion.span
              aria-hidden="true"
              className="absolute inline-flex size-full rounded-full bg-primary"
              animate={{ scale: [1, 2.2, 2.2], opacity: [0.6, 0, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
        Agent Live
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp overlay — small notification that emerges from the top-right of
// the dashboard window. Plays the demo conversation; doesn't block the
// dashboard's content significantly.
//
// Channel vs brand distinction:
//   - WhatsApp chrome (gray bg, MessageCircle icon) = channel
//   - Customer bubble (bg-muted) = channel message
//   - Recepta bot bubble (bg-primary) = brand layer
//   - "Appointment booked" pill = Recepta confirmation
// ---------------------------------------------------------------------------

function WhatsAppOverlay({
  phase,
  scenario,
  reduced,
}: {
  phase: DemoPhase;
  scenario: Scenario;
  reduced: boolean;
}) {
  // The overlay is hidden during IDLE and RESET phases. Otherwise it shows
  // the bubbles appropriate for the current phase.
  const showOverlay = phase === "INCOMING" || phase === "PROCESSING" || phase === "REPLY" || phase === "DASHBOARD_REACT";

  return (
    <AnimatePresence>
      {showOverlay && (
        <motion.div
          key="wa-overlay"
          initial={reduced ? false : { opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          className="absolute right-3 top-3 z-20 w-[280px] origin-top-right rounded-xl border border-border/70 bg-white shadow-luxe ring-1 ring-black/[0.04] lg:right-6 lg:w-[300px]"
          aria-label="Live WhatsApp conversation preview"
        >
          {/* Header — WhatsApp brand cue */}
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <div className="grid size-6 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.10_150)] text-white">
              <MessageCircle className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[11px] font-semibold">WhatsApp · Bella</div>
              <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <span className="size-1 rounded-full bg-primary animate-pulse" />
                new message
              </div>
            </div>
          </div>

          {/* Conversation */}
          <div className="space-y-1.5 p-2.5">
            {/* Customer bubble — visible from INCOMING onward */}
            <PhaseGate phase={phase} target="INCOMING">
              <ChatBubble side="customer" reduced={reduced}>
                {scenario.customer}
              </ChatBubble>
            </PhaseGate>

            {/* Processing indicator — PROCESSING phase only. Dots + the
                literal "Recepta is responding…" label so visitors understand
                the AI is doing work, without resorting to a generic spinner. */}
            <PhaseGate phase={phase} target="PROCESSING">
              <ProcessingBubble />
            </PhaseGate>

            {/* Bot reply + booked pill — REPLY onward */}
            <PhaseGate phase={phase} target="REPLY">
              <ChatBubble side="bot" reduced={reduced}>
                {scenario.bot}
              </ChatBubble>
            </PhaseGate>
            <PhaseGate phase={phase} target="REPLY">
              <div className="flex justify-end pt-0.5">
                <motion.div
                  initial={reduced ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0, 0, 0.2, 1] }}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/30"
                >
                  <span aria-hidden="true">✓</span> Appointment booked
                </motion.div>
              </div>
            </PhaseGate>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small wrapper that only renders children when the demo has reached `target`. */
function PhaseGate({
  phase,
  target,
  children,
}: {
  phase: DemoPhase;
  target: DemoPhase;
  children: React.ReactNode;
}) {
  const visible = phaseAtLeast(phase, target);
  return (
    <AnimatePresence>
      {visible && <div key={`${target}-${phase}`}>{children}</div>}
    </AnimatePresence>
  );
}

function ChatBubble({
  side,
  reduced,
  children,
}: {
  side: "customer" | "bot";
  reduced: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      className={cn("flex", side === "customer" ? "justify-start" : "justify-end")}
    >
      <div
        className={cn(
          "max-w-[88%] rounded-2xl px-3 py-1.5 text-[11.5px] leading-snug",
          side === "customer"
            ? // Channel color — neutral, signals "this is from WhatsApp / customer"
              "rounded-bl-md bg-muted text-foreground"
            : // Brand color — Recepta's reply
              "rounded-br-md bg-primary text-primary-foreground",
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}

function ProcessingBubble() {
  // A single branded bubble that says both "AI is working" (the dots) and
  // "this is the Recepta AI" (the label). Sits inside the WhatsApp overlay
  // during the PROCESSING phase only, then is replaced by the bot reply.
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      className="flex justify-end"
    >
      <div className="flex items-center gap-2 rounded-2xl rounded-br-md bg-primary/85 px-3 py-1.5">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-1 rounded-full bg-primary-foreground/85"
              animate={{ y: [0, -1.5, 0], opacity: [0.45, 0.95, 0.45] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.18,
              }}
            />
          ))}
        </div>
        <span className="text-[10px] font-medium text-primary-foreground/90">
          Recepta is responding…
        </span>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — visible on md+. Mirrors the real TenantShell sidebar block:
// brand, salon switcher, nav. All static.
// ---------------------------------------------------------------------------

function Sidebar() {
  return (
    <aside className="hidden flex-col gap-2.5 border-r border-border/60 bg-[oklch(0.97_0.008_70)] p-3 md:flex">
      <div className="flex items-center gap-2 px-1">
        <div className="grid size-7 place-items-center rounded-lg bg-gradient-luxe text-white shadow-luxe">
          <Sparkles className="size-3.5" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-sm font-semibold">Recepta</div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Owner Dashboard
          </div>
        </div>
      </div>

      {/* Salon switcher — visual only. Same shape as the real dropdown trigger. */}
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg border border-border/60 bg-white px-2 py-1.5 text-left"
      >
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <LayoutDashboard className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold">Bella Salon</div>
          <div className="truncate text-[9px] text-muted-foreground">Lahore</div>
        </div>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>

      <nav className="space-y-0.5" aria-label="Dashboard navigation preview">
        <NavItem icon={LayoutDashboard} label="Overview" active />
        <NavItem icon={CalendarDays} label="Bookings" />
        <NavItem icon={MessagesSquare} label="Escalations" />
        <NavItem icon={Scissors} label="Services" />
        <NavItem icon={Bot} label="AI Rules" />
      </nav>
    </aside>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof LayoutDashboard;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]",
        active
          ? "bg-primary font-medium text-primary-foreground shadow-sm"
          : "text-foreground/70",
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main — greeting + KPI strip + chart + recent activity.
// ---------------------------------------------------------------------------

function Main({
  liveItem,
  bookingsMV,
  highlightBookings,
  reduced,
}: {
  liveItem: FeedItem | null;
  bookingsMV: MotionValue<number>;
  highlightBookings: boolean;
  reduced: boolean;
}) {
  return (
    <div className="min-w-0 space-y-4 bg-white p-4 md:p-5">
      {/* Mobile-only inline brand — sidebar is hidden, so keep the brand visible. */}
      <div className="flex items-center gap-2 md:hidden">
        <div className="grid size-7 place-items-center rounded-lg bg-gradient-luxe text-white">
          <Sparkles className="size-3.5" />
        </div>
        <span className="font-display text-sm font-semibold">Recepta · Bella Salon</span>
      </div>

      <div>
        <div className="text-base font-semibold tracking-tight">Good morning, Sana 👋</div>
        <div className="text-[11px] text-muted-foreground">
          Your AI agent handled 4 new conversations in the last hour.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {DEMO_KPIS.map((k, i) => (
          // First KPI (Bookings) is the one that animates with the demo —
          // all other KPIs stay static so the eye lands on the change.
          <KpiCard
            key={k.label}
            {...k}
            animatedValue={i === 0 ? bookingsMV : undefined}
            highlight={i === 0 ? highlightBookings : false}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.35fr_1fr]">
        <ChartCard reduced={reduced} />
        <FeedCard liveItem={liveItem} reduced={reduced} />
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  animatedValue,
  highlight,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof CalendarCheck;
  /** When provided, the value renders from this motion value (animated count). */
  animatedValue?: MotionValue<number>;
  /** When true, card pulses subtly to draw attention to a value change. */
  highlight?: boolean;
}) {
  return (
    <Card
      className={cn(
        "border bg-white shadow-none transition-shadow duration-500",
        highlight && "shadow-[0_0_0_2px_oklch(0.45_0.10_195_/_0.35)]",
      )}
    >
      <CardContent className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <motion.div
              animate={highlight ? { scale: [1, 1.05, 1] } : { scale: 1 }}
              transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
              className={cn(
                "mt-1 origin-left text-xl font-semibold tracking-tight transition-colors duration-500",
                highlight && "text-primary",
              )}
            >
              {animatedValue ? <AnimatedNumber motionValue={animatedValue} /> : value}
            </motion.div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>
          </div>
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-3.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Renders the rounded integer value of a motion value. */
function AnimatedNumber({ motionValue }: { motionValue: MotionValue<number> }) {
  const rounded = useTransform(motionValue, (v) => Math.round(v));
  return <motion.span>{rounded}</motion.span>;
}

function ChartCard({ reduced }: { reduced: boolean }) {
  return (
    <Card className="border shadow-none bg-white">
      <CardHeader className="px-3.5 pt-3.5 pb-1">
        <CardTitle className="text-[13px]">Conversation activity · today</CardTitle>
        <div className="text-[10px] text-muted-foreground">
          Messages handled by Recepta, hour by hour.
        </div>
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={DEMO_HOURLY} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 70)" vertical={false} />
              <XAxis
                dataKey="h"
                stroke="oklch(0.5 0.02 40)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="oklch(0.5 0.02 40)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip
                cursor={{ fill: "oklch(0.94 0.04 195 / 0.45)" }}
                contentStyle={{
                  background: "white",
                  border: "1px solid oklch(0.92 0.01 70)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelStyle={{ color: "oklch(0.4 0.02 40)", fontWeight: 600 }}
              />
              {/* Subtle bar entrance — Recharts built-in. 700ms ease-out feels
                  like the chart is "settling" rather than loading. Skipped on
                  reduced-motion so the bars are immediately visible. */}
              <Bar
                dataKey="c"
                fill="oklch(0.45 0.10 195)"
                radius={[5, 5, 0, 0]}
                isAnimationActive={!reduced}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// FeedCard — Recent AI Activity. The "live item" from the current cycle
// animates into the top of the feed during RECORDED onward, then fades out
// during RESET. The 3 baseline entries stay put underneath.
// ---------------------------------------------------------------------------

function FeedCard({ liveItem, reduced }: { liveItem: FeedItem | null; reduced: boolean }) {
  // Compose the displayed list: live item on top (if present), then the
  // 3 baseline entries. Cap to 4 rows so the card height stays stable.
  const items: FeedItem[] = liveItem
    ? [liveItem, ...DEMO_FEED_BASELINE].slice(0, 4)
    : DEMO_FEED_BASELINE;

  return (
    <Card className="border shadow-none bg-white">
      <CardHeader className="px-3.5 pt-3.5 pb-1">
        <CardTitle className="text-[13px]">Recent AI activity</CardTitle>
        <div className="text-[10px] text-muted-foreground">What Recepta did for you.</div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Staggered baseline reveal — the 3 fixed rows can animate in
            line-by-line on mount so the feed feels like it's filling up
            rather than appearing instantly. Skipped on reduced-motion. The
            live item's own reveal is still controlled by `i === 0 && liveItem`. */}
        <motion.ul
          className="divide-y divide-border/40"
          initial={reduced ? false : "hidden"}
          animate={reduced ? undefined : "visible"}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05, delayChildren: 0.3 } },
          }}
        >
          <AnimatePresence initial={false}>
            {items.map((f, i) => (
              <motion.li
                key={`${f.text}-${i}`}
                layout
                initial={
                  reduced
                    ? false
                    : i === 0 && liveItem
                      ? { opacity: 0, y: -6 }
                      : { opacity: 0, y: -4 }
                }
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                className="relative flex items-start gap-2.5 px-3.5 py-2.5"
              >
                {/* Teal left-border pulse on the live row. Signals "this row
                    was just added because of the conversation above" so the
                    visitor's eye connects the two events. */}
                {i === 0 && liveItem && (
                  <motion.span
                    aria-hidden="true"
                    initial={{ opacity: 0, scaleY: 0 }}
                    animate={{
                      opacity: [0, 1, 1, 0],
                      scaleY: [0, 1, 1, 1],
                    }}
                    transition={{
                      duration: 1.8,
                      times: [0, 0.12, 0.6, 1],
                      ease: [0.4, 0, 0.2, 1],
                    }}
                    className="absolute left-0 top-0 h-full w-[3px] origin-top rounded-r-full bg-primary"
                  />
                )}
                <div
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-md",
                    f.tone === "success" && "bg-success-soft text-primary",
                    f.tone === "warn" && "bg-warning-soft text-[oklch(0.45_0.14_70)]",
                    f.tone === "default" && "bg-muted text-muted-foreground",
                  )}
                >
                  <MessageCircle className="size-3" />
                </div>
                <div className="min-w-0 flex-1 text-[11px] leading-snug">{f.text}</div>
                <div className="shrink-0 text-[10px] text-muted-foreground">{f.time}</div>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      </CardContent>
    </Card>
  );
}