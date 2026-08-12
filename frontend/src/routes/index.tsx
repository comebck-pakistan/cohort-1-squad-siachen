import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles,
  MessageCircle,
  CalendarDays,
  Scissors,
  Check,
  ArrowRight,
  UserPlus,
  Smartphone,
  Pause,
  Inbox,
  HelpCircle,
  Plus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AuroraBackground,
  FadeIn,
  HeroProductDemo,
  HoverCard,
  MagneticButton,
  Reveal,
  ScrollProgress,
  SectionReveal,
  Stagger,
  StaggerItem,
  useActiveSection,
  useBoundedCycle,
  DURATION,
  EASE,
} from "@/components/motion";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Recepta — WhatsApp AI Receptionist for Pakistani Salons" },
      {
        name: "description",
        content:
          "Recepta is the WhatsApp salon receptionist that books appointments, answers inquiries, and checks availability in English, Urdu, and Roman Urdu — 24/7.",
      },
      { property: "og:title", content: "Recepta — WhatsApp AI Receptionist for Salons" },
      {
        property: "og:description",
        content:
          "WhatsApp receptionist for beauty salons, spas, and barbershops in Pakistan. English, Urdu & Roman Urdu.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ScrollProgress />
      <Nav />
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <Faq />
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navbar — entrance + scroll-state compaction + shared layout indicator
// ---------------------------------------------------------------------------

const NAV_SECTIONS = ["features", "how-it-works", "pricing", "faq"] as const;
type NavSection = (typeof NAV_SECTIONS)[number];

function Nav() {
  const activeSection = useActiveSection({ ids: [...NAV_SECTIONS] });
  // Track scroll position to compact the navbar once the user leaves the hero.
  const { scrollY } = useScroll();
  const compact = useTransform(scrollY, (v) => v > 80);

  return (
    <motion.header
      // Entrance: subtle fade + downward translate.
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.section, ease: EASE.out }}
      className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl transition-[background-color,backdrop-filter] duration-300 supports-[backdrop-filter]:bg-background/60"
    >
      <motion.div
        // Scroll compaction — once user scrolls past 80px, height shrinks from
        // 64px to 56px. Subtle but visible.
        animate={compact ? { height: 56 } : { height: 64 }}
        transition={{ duration: DURATION.standard, ease: EASE.standard }}
        className="mx-auto flex max-w-7xl items-center justify-between px-6"
      >
        <Link to="/" className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
            <Sparkles className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold tracking-tight">Recepta</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Salon AI Receptionist
            </div>
          </div>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_SECTIONS.map((id) => (
            <NavLink key={id} id={id} active={activeSection === id} />
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Log In</Link>
          </Button>
          <Button asChild size="sm" className="bg-gradient-luxe text-white shadow-luxe hover:opacity-95">
            <Link to="/onboarding">
              Start Free Trial
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </motion.div>
    </motion.header>
  );
}

function NavLink({ id, active }: { id: NavSection; active: boolean }) {
  const label = id === "how-it-works" ? "How it works" : id.charAt(0).toUpperCase() + id.slice(1);
  return (
    <a
      href={`#${id}`}
      className={cn(
        "relative text-sm transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      {active && (
        // Shared layout indicator — one element, slides between active links.
        // Using a single motion.span with layoutId makes Motion interpolate
        // the position automatically.
        <motion.span
          layoutId="nav-indicator"
          className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-primary"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Hero — staggered entrance + magnetic primary CTA + HeroProductDemo
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-warm">
      {/* Ambient background — slow-drifting cream + peach + green blobs. */}
      <AuroraBackground className="absolute inset-0 -z-10" />

      <div className="mx-auto grid max-w-7xl gap-14 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
        <div className="flex flex-col justify-center">
          <FadeIn delay={0}>
            <Badge className="w-fit rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="mr-1 size-3" /> Early access · 7-day free trial
            </Badge>
          </FadeIn>

          <FadeIn delay={0.1} y={16}>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground md:text-6xl">
              Never miss another <span className="text-gradient-luxe">salon booking.</span>
              {/* Line break only on desktop — on mobile let the sentence flow
                  naturally so we don't force a single-word orphan line. */}
              <br className="hidden md:inline" />
              {" "}A WhatsApp receptionist that <span className="text-gradient-luxe">never sleeps.</span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.25} y={12}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Recepta automatically answers WhatsApp messages in natural English, Urdu, and Roman
              Urdu — handles client inquiries, checks availability, and books appointments 24/7 so
              your chair stays full while you focus on the craft.
            </p>
          </FadeIn>

          <FadeIn delay={0.4} y={12}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {/* Primary CTA — magnetic on desktop. */}
              <MagneticButton className="inline-block">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-full bg-gradient-luxe px-7 text-base text-white shadow-luxe hover:opacity-95"
                >
                  <Link to="/waitlist">
                    Join the waitlist
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </Button>
              </MagneticButton>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-foreground/20 bg-background/60 px-6 text-base backdrop-blur"
              >
                <a href="#pricing">See Pricing</a>
              </Button>
            </div>
          </FadeIn>

          <FadeIn delay={0.55} y={8}>
            <div className="mt-4 text-xs text-muted-foreground">
              Want to try it now instead?{" "}
              <Link
                to="/onboarding"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Start the 7-day trial →
              </Link>
            </div>
          </FadeIn>

          <FadeIn delay={0.7} y={8}>
            <div className="mt-6 flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" /> WhatsApp-only agent
              </div>
              <div className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" /> English · Urdu · Roman Urdu
              </div>
              <div className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" /> Set up in under 10 min
              </div>
            </div>
          </FadeIn>
        </div>

        {/* Right column: simulated WhatsApp + booking demo. */}
        <FadeIn delay={0.35} y={20}>
          <HeroProductDemo />
        </FadeIn>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Features — interactive cards with miniature per-card demonstrations
// ---------------------------------------------------------------------------

function Features() {
  const items: FeatureItem[] = [
    {
      icon: MessageCircle,
      title: "24/7 WhatsApp Answering",
      desc:
        "Replies in natural English, Urdu, and Roman Urdu. Customers message your existing WhatsApp number like they always have — no app install required.",
      visual: <ChatBubblesDemo />,
    },
    {
      icon: CalendarDays,
      title: "Smart Booking via Chat",
      desc:
        "Customers describe what they want in plain Urdu or English. Recepta checks your real-time availability and confirms the appointment — no back-and-forth.",
      visual: <SlotsDemo />,
    },
    {
      icon: Inbox,
      title: "Owner Dashboard & Inbox",
      desc:
        "Every conversation archived. Full bookings list, working hours, services, and AI rules — all editable from one place. Take over any conversation manually when you need to.",
      visual: <InboxDemo />,
    },
    {
      icon: Pause,
      title: "Pause Anytime",
      desc:
        "Flip the AI off with a single toggle in the dashboard header. The bot stops replying immediately; customers who message during the pause are saved to your Inbox for later.",
      visual: <PauseDemo />,
    },
  ];

  return (
    <section id="features" className="border-y border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionReveal
          cadence={0.1}
          eyebrow={
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Built for Pakistani salons
            </div>
          }
          heading={
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              Everything a great front-desk does. <span className="text-gradient-luxe">Only better.</span>
            </h2>
          }
          description={
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
              Recepta handles the WhatsApp messages every salon gets — the late-night booking
              requests, the "kal kitne baje available hai?" replies, the reschedules — so you can
              focus on the chair.
            </p>
          }
        />

        <Stagger className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <StaggerItem key={it.title} className="lg:[&:nth-child(4)]:col-span-1">
              <FeatureCard item={it} />
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

interface FeatureItem {
  icon: typeof MessageCircle;
  title: string;
  desc: string;
  visual: React.ReactNode;
}

function FeatureCard({ item }: { item: FeatureItem }) {
  return (
    <HoverCard className="group relative h-full rounded-2xl border border-border/70 bg-card p-6 transition-all hover:border-primary/30 hover:shadow-luxe">
      <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <item.icon className="size-5" />
      </div>
      <h3 className="mt-5 font-display text-xl font-semibold">{item.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
      {/* Mini-demo strip — only renders on hover to keep the rest state clean. */}
      <div className="mt-5 h-12 overflow-hidden rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[11px] text-muted-foreground opacity-90 transition-opacity">
        {item.visual}
      </div>
    </HoverCard>
  );
}

// ---- Per-feature mini-demos ----

function ChatBubblesDemo() {
  const prefersReducedMotion = useReducedMotion();
  // Three-step chat loop: customer message → typing indicator → bot reply.
  // Runs a bounded number of cycles, then parks on the bot reply (restPhase).
  const step = useBoundedCycle("chat-bubbles", {
    phaseCount: 3,
    restPhase: 2,
    cycles: 3,
    intervalMs: 2200,
  });
  return (
    <div className="flex h-full items-center gap-2">
      <AnimatePresence mode="wait" initial={false}>
        {step === 0 && (
          <motion.span
            key="s0"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="rounded-full bg-muted px-2 py-0.5"
          >
            Salam
          </motion.span>
        )}
        {step === 1 && (
          <motion.span
            key="s1"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-1 rounded-full bg-primary/80 px-2 py-0.5 text-primary-foreground"
            aria-label="Bot is typing"
          >
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-1 rounded-full bg-primary-foreground/80"
                animate={prefersReducedMotion ? {} : { opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }}
              />
            ))}
          </motion.span>
        )}
        {step === 2 && (
          <motion.span
            key="s2"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="rounded-full bg-primary/80 px-2 py-0.5 text-primary-foreground"
          >
            Walaikum salam!
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function SlotsDemo() {
  const prefersReducedMotion = useReducedMotion();
  // Three slots. Cycle through: all available → one selected → that one confirmed.
  const slots = ["10:00", "12:30", "5:30"];
  // Bounded cycle parks on 2 (confirmed).
  const phase = useBoundedCycle("slots", {
    phaseCount: 3,
    restPhase: 2,
    cycles: 3,
    intervalMs: 1800,
  });
  const statusFor = (i: number): "available" | "selected" | "confirmed" => {
    if (phase === 0) return "available";
    if (i === 2) return phase === 1 ? "selected" : "confirmed";
    return "available";
  };
  return (
    <div className="flex h-full items-center gap-2">
      {slots.map((t, i) => {
        const status = statusFor(i);
        return (
          <motion.span
            key={t}
            animate={
              prefersReducedMotion
                ? {}
                : {
                    backgroundColor:
                      status === "confirmed"
                        ? "oklch(0.45 0.10 195 / 0.92)"
                        : status === "selected"
                        ? "oklch(0.45 0.10 195 / 0.55)"
                        : "oklch(0.92 0.02 70)",
                    color:
                      status === "available"
                        ? "oklch(0.4 0.02 40)"
                        : "oklch(0.99 0.005 90)",
                  }
            }
            transition={{ duration: DURATION.standard, ease: EASE.standard }}
            className="rounded-full px-2 py-0.5 font-mono text-[10px]"
          >
            {t}
          </motion.span>
        );
      })}
      <AnimatePresence>
        {phase === 2 && (
          <motion.span
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="ml-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"
          >
            ✓
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function InboxDemo() {
  const prefersReducedMotion = useReducedMotion();
  // Bounded cycle: parks on read (unread=false) after a few new ↔ read toggles.
  const phase = useBoundedCycle("inbox", {
    phaseCount: 2,
    restPhase: 1,
    cycles: 3,
    intervalMs: 2600,
  });
  const unread = phase === 0;
  return (
    <div className="flex h-full items-center gap-2">
      <div className="flex flex-1 flex-col gap-1 overflow-hidden">
        <motion.div
          animate={
            prefersReducedMotion
              ? {}
              : {
                  backgroundColor: unread
                    ? "oklch(0.45 0.10 195 / 0.15)"
                    : "oklch(0.95 0.01 70)",
                  opacity: unread ? 1 : 0.7,
                }
          }
          transition={{ duration: DURATION.standard, ease: EASE.standard }}
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px]"
        >
          <span className="font-semibold">Hira</span>
          <span className="truncate text-muted-foreground">Kal HydraFacial?</span>
        </motion.div>
        <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] opacity-70">
          <span className="font-semibold">Sana</span>
          <span className="truncate text-muted-foreground">✓ Booked</span>
        </div>
      </div>
      <AnimatePresence>
        {unread && (
          <motion.span
            key="badge"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.25 }}
            className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground"
          >
            1
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function PauseDemo() {
  const prefersReducedMotion = useReducedMotion();
  // Bounded cycle: parks on ACTIVE (restPhase=0) after a few ACTIVE ↔ PAUSED
  // toggles, signalling "owner has control and resumed".
  const phase = useBoundedCycle("pause", {
    phaseCount: 2,
    restPhase: 0,
    cycles: 2,
    intervalMs: 2500,
  });
  const active = phase === 0;
  return (
    // A real dashboard toggle — pill with a knob that slides, plus the label.
    // Communicates "owner stays in control" through familiar control shape.
    <div className="flex h-full items-center gap-2 font-mono text-[10px]">
      <div className="relative flex items-center">
        <motion.div
          aria-hidden="true"
          className="relative h-4 w-8 rounded-full"
          animate={{
            backgroundColor: active ? "oklch(0.45 0.10 195 / 0.85)" : "oklch(0.85 0.05 70 / 0.6)",
          }}
          transition={{ duration: DURATION.standard, ease: EASE.standard }}
        >
          <motion.span
            className="absolute top-0.5 size-3 rounded-full bg-white shadow-luxe"
            animate={{ left: active ? "calc(100% - 14px)" : 2 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          />
        </motion.div>
      </div>
      <motion.span
        animate={{
          color: active ? "oklch(0.42 0.10 195)" : "oklch(0.5 0.02 40)",
        }}
        transition={{ duration: DURATION.standard, ease: EASE.standard }}
        className="font-sans font-semibold"
      >
        {active ? "ACTIVE" : "PAUSED"}
      </motion.span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HowItWorks — vertical scroll-linked progress timeline
// ---------------------------------------------------------------------------

interface HowItWorksStep {
  n: number;
  icon: typeof UserPlus;
  title: string;
  desc: string;
}

function HowItWorks() {
  const steps: HowItWorksStep[] = [
    {
      n: 1,
      icon: UserPlus,
      title: "Sign up",
      desc:
        "Create your salon account with email, WhatsApp number, salon name, and city. Takes about two minutes.",
    },
    {
      n: 2,
      icon: Scissors,
      title: "Add your services",
      desc:
        "Enter the services you offer, durations, prices, and working hours. You can edit all of this later from the dashboard.",
    },
    {
      n: 3,
      icon: Smartphone,
      title: "Connect WhatsApp",
      desc:
        "Pair your existing business number — either scan a QR code or enter your phone for a one-time code. Your current WhatsApp stays put.",
    },
    {
      n: 4,
      icon: Sparkles,
      title: "Bot goes live",
      desc:
        "Recepta starts replying to your customers within minutes. Watch conversations live in your Inbox, or take over manually whenever you want.",
    },
  ];

  return (
    <section id="how-it-works" className="bg-background">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionReveal
          cadence={0.1}
          className="mx-auto max-w-2xl text-center"
          eyebrow={
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              How it works
            </div>
          }
          heading={
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              From sign-up to live in <span className="text-gradient-luxe">under 10 minutes.</span>
            </h2>
          }
          description={
            <p className="mt-4 text-lg text-muted-foreground">
              No new phone number, no new app for your customers to install, no credit card up front.
            </p>
          }
        />

        <Timeline steps={steps} />
      </div>
    </section>
  );
}

function Timeline({ steps }: { steps: HowItWorksStep[] }) {
  const prefersReducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);

  // Section-scoped scroll progress: 0 when the section's top reaches the
  // bottom of the viewport, 1 when the section's bottom reaches the top.
  // This guarantees the ramp hits 1 by the time the section exits, so
  // step 4 can always become active.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  // Line fills from top to bottom as scrollYProgress goes 0 → 1.
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  // Active step index — derived deterministically from scrollYProgress so
  // steps activate 0 → 1 → 2 → 3 in strict sequence with no skips.
  // We use a tiny epsilon on the upper bound so progress=1 still maps to
  // the last step (instead of stepping past it).
  const activeIndexMV = useTransform(
    scrollYProgress,
    (p) => Math.min(steps.length - 1, Math.floor(p * steps.length)),
  );
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion) return;
    const unsub = activeIndexMV.on("change", (v) => setActiveIdx(v));
    return () => unsub();
  }, [activeIndexMV, prefersReducedMotion]);

  return (
    <div ref={sectionRef} className="relative mt-16 grid gap-10 md:grid-cols-[1fr_2fr]">
      {/* Left column: timeline (numbered circles on the line + content) */}
      <ol className="relative">
        {/* Background line (unfilled portion). Sits in its own column thanks
            to the grid below. transform-origin: top so it grows downward.
            Horizontal offset: each row's circle column is 56px wide with a
            size-9 (36px) circle `justify-self-center`. That puts the circle's
            horizontal center at 28px from the row's left edge. The line is
            2px wide, so its center is at `left + 1` → we set `left-[27px]`
            so the line passes exactly through the circle's center across
            every step. */}
        <div className="absolute left-[27px] top-0 h-full w-[2px] bg-border/60" aria-hidden="true" />
        <motion.div
          aria-hidden="true"
          style={{
            scaleY: prefersReducedMotion ? 1 : lineScale,
            transformOrigin: "top",
          }}
          className="absolute left-[27px] top-0 h-full w-[2px] bg-gradient-to-b from-primary to-primary/30"
        />
        {steps.map((s, i) => (
          <li key={s.n} className="relative mb-10 last:mb-0">
            {/* Three-column grid per row:
                  [circle column 56px] [line column 36px] [content column 1fr]
                so the numbered circle sits centered ON the line and the
                content has comfortable breathing room from the line. */}
            <div
              className="grid items-start gap-x-6"
              style={{ gridTemplateColumns: "56px 36px 1fr" }}
            >
              {/* Numbered circle — centered on the line. */}
              <span
                className={cn(
                  "grid size-9 place-items-center justify-self-center rounded-full text-sm font-semibold text-white shadow-luxe transition-colors duration-300",
                  // Highlight the active step's circle.
                  prefersReducedMotion
                    ? "bg-gradient-luxe"
                    : activeIdx >= i
                    ? "bg-gradient-luxe"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {s.n}
              </span>
              {/* Spacer column — keeps the line aligned regardless of content height. */}
              <div />
              {/* Content: icon + title on one row, description below. */}
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                    <s.icon className="size-4" />
                  </div>
                  <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* Right column: per-step visual. Cross-fades based on the same activeIdx. */}
      <TimelineVisual steps={steps} activeIdx={activeIdx} />
    </div>
  );
}

function TimelineVisual({
  steps,
  activeIdx,
}: {
  steps: HowItWorksStep[];
  activeIdx: number;
}) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    // Show all 4 stacked vertically, no cross-fade.
    return (
      <div className="grid gap-4">
        {steps.map((s) => (
          <Reveal key={s.n}>
            <div className="rounded-2xl border border-border/70 bg-card p-5">
              <div className="text-xs font-semibold uppercase tracking-widest text-primary">Step {s.n}</div>
              <div className="mt-1 font-display text-lg font-semibold">{s.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    );
  }

  return (
    <div className="relative min-h-[320px]">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeIdx}
          // Calm cross-fade — opacity + small translateY, slight scale.
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
          className="rounded-2xl border border-border/70 bg-card p-6 shadow-luxe"
        >
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">
            Step {steps[activeIdx].n} of {steps.length}
          </div>
          <div className="mt-1 font-display text-2xl font-semibold">{steps[activeIdx].title}</div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{steps[activeIdx].desc}</p>
          <div className="mt-5">
            <StepVisual stepIndex={activeIdx} />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepVisual — per-step demonstration that lives inside TimelineVisual.
//
// Each step has its own small visual that demonstrates the step:
//   1. Sign up        → form populates, account created
//   2. Add services   → service list with a row being added
//   3. Connect WA     → pairing card → connected
//   4. Bot goes live  → customer message → bot reply → confirmation
//
// All four run on their own quiet cycle so the visual keeps changing while
// the visitor reads, which makes the section feel alive without being noisy.
// ---------------------------------------------------------------------------

function StepVisual({ stepIndex }: { stepIndex: number }) {
  switch (stepIndex) {
    case 0:
      return <SignUpVisual playKey={stepIndex} />;
    case 1:
      return <ServicesVisual playKey={stepIndex} />;
    case 2:
      return <PairingVisual playKey={stepIndex} />;
    case 3:
      return <BotLiveVisual playKey={stepIndex} />;
    default:
      return null;
  }
}

function SignUpVisual({ playKey }: { playKey: number }) {
  const prefersReducedMotion = useReducedMotion();
  // Phase 0: empty, 1: filling, 2: created. Bounded cycle parks on 2 (created).
  const phase = useBoundedCycle(playKey, {
    phaseCount: 3,
    restPhase: 2,
    cycles: 2,
    intervalMs: 2400,
  });
  const fields = [
    { label: "Salon name", value: "Bella Salon" },
    { label: "WhatsApp", value: "+92 300 1234567" },
    { label: "City", value: "Lahore" },
  ];
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-4">
      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={f.label} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{f.label}</span>
            <div className="relative h-7 flex-1 overflow-hidden rounded-md border border-border/60 bg-background">
              <AnimatePresence>
                {phase >= 1 && (
                  <motion.span
                    key="v"
                    initial={prefersReducedMotion ? false : { opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.18 }}
                    className="absolute inset-0 flex items-center px-2 text-xs text-foreground"
                  >
                    {f.value}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <AnimatePresence mode="wait">
          {phase === 2 ? (
            <motion.div
              key="created"
              initial={prefersReducedMotion ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary"
            >
              <Check className="size-4" /> Account created
            </motion.div>
          ) : (
            <motion.div
              key="btn"
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              Ready to create →
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button
          type="button"
          aria-label="Create account"
          animate={{
            backgroundColor: phase === 2 ? "oklch(0.45 0.10 195 / 0.85)" : "oklch(0.99 0.005 90)",
            color: phase === 2 ? "oklch(0.99 0.005 90)" : "oklch(0.4 0.02 40)",
            borderColor: phase === 2 ? "oklch(0.45 0.10 195 / 0.85)" : "oklch(0.85 0.01 70)",
          }}
          transition={{ duration: DURATION.standard, ease: EASE.standard }}
          className="rounded-full border px-3 py-1 text-[11px] font-semibold"
        >
          {phase === 2 ? "Done" : "Create account"}
        </motion.button>
      </div>
    </div>
  );
}

function ServicesVisual({ playKey }: { playKey: number }) {
  const prefersReducedMotion = useReducedMotion();
  // 0: idle, 1: row being added, 2: row landed. Parks on 2 (3 services live).
  const phase = useBoundedCycle(playKey, {
    phaseCount: 3,
    restPhase: 2,
    cycles: 2,
    intervalMs: 2200,
  });
  const rows = [
    { name: "HydraFacial", price: "Rs. 6,500" },
    { name: "Hair Colour", price: "Rs. 9,500" },
  ];
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-4">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.name}
            className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2"
          >
            <span className="text-xs font-medium">{r.name}</span>
            <span className="text-[11px] font-semibold text-muted-foreground">{r.price}</span>
          </li>
        ))}
        <AnimatePresence>
          {phase >= 1 && (
            <motion.li
              key="new"
              initial={prefersReducedMotion ? false : { opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 26 }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                <span className="text-xs font-medium">Gel Manicure</span>
                <span className="text-[11px] font-semibold text-primary">Rs. 2,800</span>
              </div>
            </motion.li>
          )}
        </AnimatePresence>
      </ul>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {phase === 0 ? "Add your services" : phase === 1 ? "Saving new service…" : "3 services live"}
        </span>
        <Plus className="size-4 text-primary" aria-hidden="true" />
      </div>
    </div>
  );
}

function PairingVisual({ playKey }: { playKey: number }) {
  const prefersReducedMotion = useReducedMotion();
  // 0: pairing, 1: connected. Parks on 1 (connected).
  const phase = useBoundedCycle(playKey, {
    phaseCount: 2,
    restPhase: 1,
    cycles: 3,
    intervalMs: 2600,
  });
  const connected = phase === 1;
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-4">
      <div className="flex items-center gap-4">
        <motion.div
          aria-hidden="true"
          animate={{
            borderColor: connected
              ? "oklch(0.45 0.10 195 / 0.7)"
              : "oklch(0.85 0.01 70 / 0.6)",
            backgroundColor: connected
              ? "oklch(0.45 0.10 195 / 0.08)"
              : "oklch(0.99 0.005 90 / 0.6)",
          }}
          transition={{ duration: DURATION.standard, ease: EASE.standard }}
          className="grid size-16 shrink-0 place-items-center rounded-xl border-2 border-dashed"
        >
          {connected ? (
            <Check className="size-6 text-primary" />
          ) : (
            <Smartphone className="size-6 text-muted-foreground" />
          )}
        </motion.div>
        <div className="flex-1">
          <div className="text-xs font-semibold">
            {connected ? "WhatsApp connected" : "Pair your WhatsApp"}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {connected ? "+92 300 1234567" : "Scan a QR or enter a one-time code."}
          </div>
          {!connected && (
            <div className="mt-2 flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1.5 rounded-full bg-muted-foreground/60"
                  animate={prefersReducedMotion ? {} : { opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BotLiveVisual({ playKey }: { playKey: number }) {
  const prefersReducedMotion = useReducedMotion();
  // Echoes the hero demo — 0: customer asked, 1: bot replied, 2: booked.
  // Parks on 2 (booked).
  const phase = useBoundedCycle(playKey, {
    phaseCount: 3,
    restPhase: 2,
    cycles: 2,
    intervalMs: 2200,
  });
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="flex justify-start">
        <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-muted px-3 py-1.5 text-[12px] text-foreground">
          Kal HydraFacial?
        </div>
      </div>
      <AnimatePresence>
        {phase >= 1 && (
          <motion.div
            key="reply"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex justify-end"
          >
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-[12px] text-primary-foreground">
              5:30 PM available hai ✓
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {phase === 2 && (
          <motion.div
            key="booked"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex justify-end"
          >
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
              ✅ Booked · 5:30 PM
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing — hover elevation + recommended emphasis
// ---------------------------------------------------------------------------

function Pricing() {
  const tiers: Tier[] = [
    {
      name: "Free",
      tagline: "7-day full-feature trial",
      priceMonthly: 0,
      priceLabel: "Free",
      suffix: "for 7 days",
      features: [
        "24/7 WhatsApp answering (English, Urdu, Roman Urdu)",
        "Smart booking via chat",
        "Owner dashboard & inbox (read-only)",
        "Pause AI anytime",
        "No card required",
      ],
      cta: "Start Free Trial",
      ctaTo: "/onboarding",
      popular: false,
    },
    {
      name: "Basic",
      tagline: "Single-salon owners",
      priceMonthly: 5000,
      priceLabel: "5,000",
      suffix: "PKR / month",
      features: [
        "Everything in Free — no trial expiry",
        "Unlimited bookings",
        "Edit services, hours, and holidays",
        "Take over any conversation manually",
        "Custom agent name & tone",
        "Single salon / branch",
      ],
      // CTAs reflect current product state — payment isn't self-serve yet.
      cta: "Get Early Access",
      ctaTo: "/waitlist",
      popular: true,
    },
    {
      name: "Premium",
      tagline: "Multi-staff & busy salons",
      priceMonthly: 12000,
      priceLabel: "12,000",
      suffix: "PKR / month",
      features: [
        "Everything in Basic",
        "Multi-staff support",
        "Custom AI rules & persona",
        "Priority onboarding",
        "Multi-location — coming soon",
      ],
      cta: "Request Early Access",
      ctaTo: "/waitlist",
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionReveal
          cadence={0.1}
          className="mx-auto max-w-2xl text-center"
          eyebrow={
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Pricing</div>
          }
          heading={
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              Simple plans. <span className="text-gradient-luxe">Honest numbers.</span>
            </h2>
          }
          description={
            <p className="mt-4 text-lg text-muted-foreground">
              Start with the 7-day trial. We're not running self-serve payment yet — when payment
              opens, you'll get a heads-up well in advance.
            </p>
          }
        >
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-warning-soft/60 bg-warning-soft/20 px-3 py-1.5 text-xs font-medium text-[oklch(0.45_0.14_70)]">
            Early access pricing — final numbers may shift before public launch.
          </div>
        </SectionReveal>

        <Stagger className="mt-14 grid gap-6 md:grid-cols-3">
          {tiers.map((t) => (
            <StaggerItem key={t.name}>
              <PricingCard tier={t} />
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

interface Tier {
  name: string;
  tagline: string;
  priceMonthly: number;
  priceLabel: string;
  suffix: string;
  features: string[];
  cta: string;
  ctaTo: "/onboarding" | "/waitlist";
  popular: boolean;
}

function PricingCard({ tier }: { tier: Tier }) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <HoverCard
      liftPx={tier.popular ? 6 : 4}
      noSpotlight
      className={cn(
        "relative flex h-full flex-col rounded-3xl border bg-card p-8 transition-all",
        // Hover treatment: subtle border response + slightly stronger shadow.
        tier.popular
          ? "border-primary/50 ring-1 ring-primary/20 hover:border-primary/70 hover:shadow-luxe"
          : "border-border/70 hover:border-primary/40 hover:shadow-luxe",
      )}
    >
      {tier.popular && (
        <>
          {/* Subtle pulsing border glow — only on the recommended tier. */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-primary/30"
            animate={
              prefersReducedMotion
                ? {}
                : { opacity: [0.25, 0.55, 0.25], scale: [1, 1.005, 1] }
            }
            transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-luxe px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white shadow-luxe">
            Most Popular
          </div>
        </>
      )}
      <div className="text-sm text-muted-foreground">{tier.tagline}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{tier.name}</div>
      <div className="mt-6 flex items-baseline gap-1.5">
        {tier.priceMonthly === 0 ? (
          <span className="font-display text-5xl font-semibold tracking-tight">{tier.priceLabel}</span>
        ) : (
          <>
            <span className="text-sm font-semibold text-muted-foreground">Rs.</span>
            <span className="font-display text-5xl font-semibold tracking-tight">{tier.priceLabel}</span>
          </>
        )}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{tier.suffix}</div>
      <ul className="mt-6 space-y-2.5 text-sm">
        {tier.features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="text-foreground/80">{f}</span>
          </li>
        ))}
      </ul>
      <Button
        asChild
        size="lg"
        className={cn(
          "mt-8 h-11 rounded-full",
          tier.popular
            ? "bg-gradient-luxe text-white shadow-luxe hover:opacity-95"
            : "bg-foreground text-background hover:bg-foreground/90",
        )}
      >
        <Link to={tier.ctaTo} className="group">
          {tier.cta}
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      </Button>
    </HoverCard>
  );
}

// ---------------------------------------------------------------------------
// FAQ — animated accordion with layout transition
// ---------------------------------------------------------------------------

function Faq() {
  const items = [
    {
      q: "Does it work in Urdu?",
      a: "Yes. Recepta understands and replies in English, Urdu, and Roman Urdu — and customers can mix all three in the same conversation. The bot's tone is configurable from the dashboard.",
    },
    {
      q: "What if the AI can't answer something?",
      a: "Every conversation is archived in your Inbox. If the bot isn't sure, it flags the message as an Escalation, and you can take over manually with a quick reply from the dashboard. The bot never silently drops a customer.",
    },
    {
      q: "Can I pause it anytime?",
      a: "Yes — flip the Agent Live / Agent Paused toggle in the dashboard header. The bot stops replying immediately. Customers who message during the pause window are saved to your Inbox for later.",
    },
    {
      q: "How does the free trial work?",
      a: "You get 7 days from sign-up. During the trial, the bot handles real customer conversations end-to-end. After 7 days, the bot sends a fixed message letting customers know the trial ended — and you have time to decide on a paid plan.",
    },
    {
      q: "Do my customers need to install anything?",
      a: "No. Recepta connects to your existing WhatsApp Business number — either via QR scan or phone pairing. Customers keep messaging your number exactly like they always have.",
    },
    {
      q: "What if I have multiple stylists?",
      a: "Add each team member under Services & Staff in the dashboard. Recepta handles bookings per staff member automatically. Multi-location support is on the Premium roadmap.",
    },
  ];

  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-background">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <SectionReveal
          cadence={0.1}
          className="text-center"
          eyebrow={
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <HelpCircle className="size-3" /> Questions salon owners actually ask
            </div>
          }
          heading={
            <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              Frequently asked
            </h2>
          }
        />

        <div className="mt-10 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
          {items.map((it, i) => {
            const open = openIdx === i;
            return (
              <AccordionRow
                key={it.q}
                question={it.q}
                answer={it.a}
                open={open}
                onToggle={() => setOpenIdx(open ? null : i)}
              />
            );
          })}
        </div>

        <Reveal>
          <div className="mt-8 text-center text-sm text-muted-foreground">
            Still have questions?{" "}
            <a href="mailto:hello@recepta.pk" className="font-medium text-foreground underline-offset-4 hover:underline">
              Email us
            </a>{" "}
            or{" "}
            <a href="tel:+923001234567" className="font-medium text-foreground underline-offset-4 hover:underline">
              call / WhatsApp
            </a>
            .
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function AccordionRow({
  question,
  answer,
  open,
  onToggle,
}: {
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <div className="block">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full text-left"
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="font-medium text-foreground">{question}</div>
          <motion.div
            animate={prefersReducedMotion ? {} : { rotate: open ? 45 : 0 }}
            transition={{ duration: DURATION.fast, ease: EASE.standard }}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full border text-sm transition-colors",
              open
                ? "border-foreground bg-foreground text-background"
                : "border-border/70 text-muted-foreground",
            )}
            aria-hidden="true"
          >
            <Plus className="size-3.5" />
          </motion.div>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: DURATION.standard, ease: EASE.standard }}
            style={{ overflow: "hidden" }}
          >
            {/* Inner fade — slightly delayed so the answer appears after the
                row starts opening, not before. */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0 }}
              transition={{ duration: DURATION.standard, ease: EASE.out, delay: 0.05 }}
              className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground"
            >
              {answer}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  return (
    <FadeIn>
      <footer className="border-t border-border/60 bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-lg bg-gradient-luxe text-white">
              <Sparkles className="size-4" />
            </div>
            <span className="font-display text-base font-semibold">Recepta</span>
            <span className="text-xs text-muted-foreground">© {new Date().getFullYear()} · Made in Pakistan</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <Link to="/login">Log in</Link>
            <Link to="/superadmin/login">Admin</Link>
          </div>
        </div>
      </footer>
    </FadeIn>
  );
}