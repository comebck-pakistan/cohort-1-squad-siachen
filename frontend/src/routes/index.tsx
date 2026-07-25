import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles,
  MessageCircle,
  CalendarDays,
  Scissors,
  BellRing,
  BarChart3,
  Check,
  Star,
  ArrowRight,
  Mail,
  Phone,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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
      <Nav />
      <Hero />
      <Features />
      <Pricing />
      <SocialProof />
      <ContactCta />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
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
          <a href="#features" className="text-sm text-muted-foreground hover:text-foreground">
            Features
          </a>
          <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground">
            Pricing
          </a>
          <a href="#contact" className="text-sm text-muted-foreground hover:text-foreground">
            Contact
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Log In</Link>
          </Button>
          <Button asChild size="sm" className="bg-gradient-luxe text-white shadow-luxe hover:opacity-95">
            <Link to="/onboarding">
              Get Started
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-warm">
      <div className="absolute inset-0 -z-10 opacity-40">
        <div className="absolute -top-24 left-1/3 size-[520px] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute right-0 top-40 size-[400px] rounded-full bg-rose-gold/25 blur-3xl" />
      </div>
      <div className="mx-auto grid max-w-7xl gap-14 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
        <div className="flex flex-col justify-center">
          <Badge className="w-fit rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="mr-1 size-3" /> Trusted by 300+ salons across Pakistan
          </Badge>
          <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground md:text-6xl">
            Never Miss Another <span className="text-gradient-luxe">Salon Booking.</span>
            <br />
            Meet Pakistan's <span className="text-gradient-luxe">#1 WhatsApp Receptionist.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Recepta automatically answers WhatsApp messages in natural English, Urdu, and Roman
            Urdu, handles client inquiries, checks availability, and books appointments 24/7 — so
            your chair stays full while you focus on the craft.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-full bg-gradient-luxe px-7 text-base text-white shadow-luxe hover:opacity-95"
            >
              <Link to="/onboarding">
                Get Started <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-foreground/20 bg-background/60 px-6 text-base backdrop-blur"
            >
              <a href="#pricing">See Pricing</a>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
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
        </div>

        <HeroMockup />
      </div>
    </section>
  );
}

function HeroMockup() {
  return (
    <div className="relative">
      <div className="grid gap-5 md:grid-cols-2">
        {/* WhatsApp chat */}
        <div className="relative rounded-3xl border border-border/70 bg-card p-4 shadow-luxe">
          <div className="flex items-center gap-3 border-b border-border/60 pb-3">
            <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary">
              <MessageCircle className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Recepta · Bella</div>
              <div className="flex items-center gap-1.5 text-[11px] text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                Online · Answering in Urdu
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <ChatBubble side="them">Assalam-o-Alaikum! Kal HydraFacial ka appointment mil sakta hai?</ChatBubble>
            <ChatBubble side="us">
              Walaikum Assalam! Kal 3:00 PM aur 5:30 PM available hai. Kaunsa suit karega?
            </ChatBubble>
            <ChatBubble side="them">5:30 PM chahiye 🌸</ChatBubble>
            <ChatBubble side="us">
              Perfect! Booked for tomorrow 5:30 PM with Ayesha. Would you like to add a Blow-dry (Rs. 2,000)?
            </ChatBubble>
            <ChatBubble side="them">Yes please!</ChatBubble>
            <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
              ✅ Booking confirmed · HydraFacial + Blow-dry · Rs. 8,500
            </div>
          </div>
        </div>

        {/* Calendar */}
        <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-luxe md:mt-10">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Tomorrow</div>
              <div className="font-display text-xl font-semibold">Fri 25 Jul</div>
            </div>
            <div className="rounded-full bg-emerald-glow/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
              12 bookings
            </div>
          </div>
          <div className="mt-4 space-y-2.5">
            {[
              { t: "10:00", s: "Sana K.", svc: "Women's Cut", price: "Rs. 3,500", color: "bg-primary/10 text-primary" },
              { t: "12:30", s: "Hira M.", svc: "Gel Manicure", price: "Rs. 2,800", color: "bg-rose-gold/20 text-[color:var(--rose-gold)]" },
              { t: "2:00", s: "Zara A.", svc: "Hair Colour", price: "Rs. 9,500", color: "bg-primary/10 text-primary" },
              { t: "5:30", s: "New · WhatsApp", svc: "HydraFacial + Blowdry", price: "Rs. 8,500", color: "bg-emerald-glow/15 text-primary", ai: true },
              { t: "7:00", s: "Mehak R.", svc: "Threading", price: "Rs. 1,200", color: "bg-rose-gold/20 text-[color:var(--rose-gold)]" },
            ].map((r) => (
              <div key={r.t} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-2.5">
                <div className="w-14 text-xs font-semibold text-muted-foreground">{r.t}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.svc}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.s}
                    {r.ai && <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary">AI</span>}
                  </div>
                </div>
                <div className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.color)}>{r.price}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ side, children }: { side: "us" | "them"; children: React.ReactNode }) {
  return (
    <div className={cn("flex", side === "us" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
          side === "us"
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Features() {
  const items = [
    {
      icon: MessageCircle,
      title: "24/7 WhatsApp Text Answering",
      desc: "Natural Urdu, Roman Urdu & English replies, day and night, so no client ever waits.",
    },
    {
      icon: CalendarDays,
      title: "Instant Booking Sync",
      desc: "Two-way sync with Google Calendar, Square, Fresha, and local salon software.",
    },
    {
      icon: Scissors,
      title: "Automated Upselling",
      desc: "AI suggests a HydraFacial add-on or Hair Blowdry mid-booking — lift ARPU by 22%.",
    },
    {
      icon: BellRing,
      title: "Reminders That Stop No-Shows",
      desc: "Automatic WhatsApp reminders 24h and 2h before appointments.",
    },
    {
      icon: BarChart3,
      title: "Live Transcripts & Analytics",
      desc: "Every conversation tagged by intent and turned into revenue-ready insights.",
    },
    {
      icon: Sparkles,
      title: "Trained on Pakistani Salons",
      desc: "Understands Eid rush, bridal quotes, deposits, and local pricing conventions.",
    },
  ];
  return (
    <section id="features" className="border-y border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Built for Pakistani salons
          </div>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Everything a great front-desk does. <span className="text-gradient-luxe">Only better.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Recepta is trained on the way Pakistani salons actually operate — from Eid rush bookings to
            walk-in bridal quotes.
          </p>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div
              key={it.title}
              className="group relative rounded-2xl border border-border/70 bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-luxe"
            >
              <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <it.icon className="size-5" />
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold">{it.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const [annual, setAnnual] = useState(false);
  const tiers = [
    {
      name: "Single Chair / Solo",
      priceMonthly: 5000,
      tagline: "Freelancers & one-chair studios",
      features: [
        "100 automated bookings / month",
        "WhatsApp AI bot",
        "English & Urdu support",
        "Basic Google Calendar sync",
        "Email support",
      ],
      cta: "Get Started",
      popular: false,
    },
    {
      name: "Boutique Salon",
      priceMonthly: 12000,
      tagline: "Most popular for growing salons",
      features: [
        "500 automated bookings / month",
        "WhatsApp Receptionist (English, Urdu & Roman Urdu)",
        "Custom agent name & tone",
        "Automated WhatsApp reminders",
        "Square / Fresha / Mindbody sync",
        "Live transcripts & analytics",
      ],
      cta: "Get Started",
      popular: true,
    },
    {
      name: "Luxury / Multi-Branch",
      priceMonthly: 25000,
      tagline: "Chains, med-spas & multi-city",
      features: [
        "Unlimited AI bookings",
        "Multi-location support",
        "Custom CRM integration",
        "Priority WhatsApp Business API",
        "Dedicated success manager",
      ],
      cta: "Get Started",
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="bg-background">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Pricing</div>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Plans that pay for themselves in <span className="text-gradient-luxe">one week.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            All prices in Pakistani Rupees. Save 17% with annual billing.
          </p>
          <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2">
            <span className={cn("text-sm", !annual && "font-semibold")}>Monthly</span>
            <Switch checked={annual} onCheckedChange={setAnnual} />
            <span className={cn("text-sm", annual && "font-semibold")}>
              Annual <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Save 17%</span>
            </span>
          </div>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {tiers.map((t) => {
            const price = annual ? Math.round(t.priceMonthly * 10) : t.priceMonthly;
            const suffix = annual ? "/year" : "/month";
            const tierParam = t.name.split(" ")[0].toLowerCase();
            return (
              <div
                key={t.name}
                className={cn(
                  "relative flex flex-col rounded-3xl border bg-card p-8 transition-all",
                  t.popular
                    ? "border-primary/50 shadow-luxe ring-1 ring-primary/20"
                    : "border-border/70 hover:border-primary/30 hover:shadow-luxe",
                )}
              >
                {t.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-luxe px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white shadow-luxe">
                    Most Popular
                  </div>
                )}
                <div className="text-sm text-muted-foreground">{t.tagline}</div>
                <div className="mt-1 font-display text-2xl font-semibold">{t.name}</div>
                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold text-muted-foreground">Rs.</span>
                  <span className="font-display text-5xl font-semibold tracking-tight">
                    {price.toLocaleString("en-PK")}
                  </span>
                  <span className="text-sm text-muted-foreground">{suffix}</span>
                </div>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {t.features.map((f) => (
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
                    t.popular
                      ? "bg-gradient-luxe text-white shadow-luxe hover:opacity-95"
                      : "bg-foreground text-background hover:bg-foreground/90",
                  )}
                >
                  <Link to="/onboarding" search={{ tier: tierParam, billing: annual ? "annual" : "monthly" }}>
                    {t.cta}
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SocialProof() {
  const quotes = [
    {
      q: "Recepta booked 42 appointments in our first week — most while we were sleeping. It paid for itself in 3 days.",
      a: "Ayesha Rehman",
      r: "Owner, Aura Salon & Spa · Lahore",
    },
    {
      q: "Our customers can't tell it's AI. It replies in perfect Urdu and handles Eid rush better than my staff.",
      a: "Zubair Malik",
      r: "Zubair's Grooming Loft · Karachi",
    },
    {
      q: "No-shows dropped 71%. The automated reminders alone are worth the subscription.",
      a: "Hira Sheikh",
      r: "Lush Beauty Lounge · Islamabad",
    },
  ];
  return (
    <section className="bg-gradient-warm">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid gap-6 md:grid-cols-3">
          {quotes.map((q) => (
            <div key={q.a} className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
              <div className="flex gap-0.5 text-rose-gold">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="size-4 fill-current" />
                ))}
              </div>
              <p className="mt-4 text-sm leading-relaxed">"{q.q}"</p>
              <div className="mt-5">
                <div className="text-sm font-semibold">{q.a}</div>
                <div className="text-xs text-muted-foreground">{q.r}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContactCta() {
  return (
    <section id="contact" className="bg-sidebar text-sidebar-foreground">
      <div className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
          Still confused?{" "}
          <span className="text-gradient-luxe">Talk to our team.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sidebar-foreground/70">
          We'll walk you through pricing, setup, and how Recepta fits your salon. No pressure —
          just answers.
        </p>
        <div className="mx-auto mt-10 grid max-w-2xl gap-4 sm:grid-cols-2">
          <a
            href="mailto:hello@recepta.pk"
            className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left transition-all hover:bg-white/10"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
              <Mail className="size-5" />
            </span>
            <span>
              <span className="block text-[11px] uppercase tracking-widest text-sidebar-foreground/60">
                Email us
              </span>
              <span className="block text-sm font-semibold">hello@recepta.pk</span>
            </span>
          </a>
          <a
            href="tel:+923001234567"
            className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left transition-all hover:bg-white/10"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-gradient-luxe text-white shadow-luxe">
              <Phone className="size-5" />
            </span>
            <span>
              <span className="block text-[11px] uppercase tracking-widest text-sidebar-foreground/60">
                Call or WhatsApp
              </span>
              <span className="block text-sm font-semibold">+92 300 1234567</span>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
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
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
          <Link to="/login">Log in</Link>
          <Link to="/superadmin/login">Admin</Link>
        </div>
      </div>
    </footer>
  );
}
