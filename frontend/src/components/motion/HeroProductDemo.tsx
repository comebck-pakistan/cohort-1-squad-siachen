// ---------------------------------------------------------------------------
// HeroProductDemo — interactive-state-machine mockup of a Recepta booking.
//
// Communicates the product narrative visually:
//
//   customer message → AI receptionist → availability → slot picker →
//   customer selection → booking confirmed → calendar slot updated → reset
//
// This file is the behavioral implementation of the hero. It does NOT change
// the hero's visual design — that lives in routes/index.tsx. This component
// is dropped into the hero's right column.
//
// Architecture:
//   - Explicit finite state machine (FSM). State is the single source of
//     truth; both the chat card and the calendar card derive their visual
//     state from it.
//   - A reducer `(state, event) -> state` owns transitions.
//   - A small timeline driver schedules state transitions via setTimeout
//     from inside the reducer. When the state changes, useEffect schedules
//     the next transition.
//   - AnimatePresence handles entry/exit for chat bubbles, slot chips, and
//     the booking-confirmed card.
//   - Cursor parallax: each card translates a fraction of the cursor
//     position relative to its bounding rect. Disabled on touch devices and
//     when prefers-reduced-motion is true.
//
// Reduced-motion: FSM still runs but all transitions are instantaneous
// (no AnimatePresence enter/exit animations, no float, no parallax). The
// final "booked" state is shown statically.
// ---------------------------------------------------------------------------

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLOAT_DISTANCE_PX, PARALLAX_MAX_PX } from "./tokens";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/** Named FSM states. */
type DemoState =
  | "IDLE"
  | "CUSTOMER_MESSAGE"
  | "TYPING_AVAILABILITY"
  | "AVAILABILITY_REPLY"
  | "SLOT_PICKER"
  | "CUSTOMER_SELECTION"
  | "TYPING_BOOKING"
  | "BOOKING_CONFIRMATION"
  | "PAUSE";

/** Calendar slot options surfaced in the picker. */
const SLOT_OPTIONS = ["3:00 PM", "5:30 PM"] as const;
const CHOSEN_SLOT = "5:30 PM"; // The slot the "customer" ultimately picks.

interface DemoData {
  state: DemoState;
  /** Which slot is being offered (set when AVAILABILITY_REPLY fires). */
  offeredSlots: readonly string[];
  /** The slot the customer picked (set when CUSTOMER_SELECTION fires). */
  selectedTime: string | null;
  /** The slot that's been confirmed by the bot (set when BOOKING_CONFIRMATION fires). */
  confirmedTime: string | null;
}

/** Events the reducer accepts. */
type DemoEvent =
  | { type: "START" }
  | { type: "CUSTOMER_MESSAGE_DONE" }
  | { type: "TYPING_AVAILABILITY_DONE" }
  | { type: "TAP_SLOT"; slot: string }
  | { type: "TYPING_BOOKING_DONE" }
  | { type: "BOOKING_CONFIRMATION_DONE" }
  | { type: "PAUSE_DONE" };

const initialData: DemoData = {
  state: "IDLE",
  offeredSlots: [],
  selectedTime: null,
  confirmedTime: null,
};

function reducer(data: DemoData, event: DemoEvent): DemoData {
  switch (event.type) {
    case "START":
      // Kick off the cycle.
      if (data.state !== "IDLE") return data;
      return { ...data, state: "CUSTOMER_MESSAGE" };

    case "CUSTOMER_MESSAGE_DONE":
      if (data.state !== "CUSTOMER_MESSAGE") return data;
      return { ...data, state: "TYPING_AVAILABILITY" };

    case "TYPING_AVAILABILITY_DONE":
      if (data.state !== "TYPING_AVAILABILITY") return data;
      // The bot reply comes with two offered slots. The calendar reads
      // these as the slots that should "light up".
      return {
        ...data,
        state: "AVAILABILITY_REPLY",
        offeredSlots: SLOT_OPTIONS,
      };

    case "TAP_SLOT":
      // Only the chosen slot is tappable in the demo; tapping 3:00 PM is a
      // no-op so the script keeps moving toward 5:30.
      if (data.state !== "AVAILABILITY_REPLY" && data.state !== "SLOT_PICKER") {
        return data;
      }
      if (event.slot !== CHOSEN_SLOT) return data;
      return {
        ...data,
        state: "CUSTOMER_SELECTION",
        selectedTime: event.slot,
      };

    case "TYPING_BOOKING_DONE":
      if (data.state !== "CUSTOMER_SELECTION") return data;
      return { ...data, state: "TYPING_BOOKING" };

    case "BOOKING_CONFIRMATION_DONE":
      if (data.state !== "TYPING_BOOKING") return data;
      // The bot's confirmation locks the selected time.
      return {
        ...data,
        state: "BOOKING_CONFIRMATION",
        confirmedTime: data.selectedTime,
      };

    case "PAUSE_DONE":
      if (data.state !== "BOOKING_CONFIRMATION") return data;
      // Reset everything and go back to IDLE.
      return {
        state: "PAUSE",
        offeredSlots: [],
        selectedTime: null,
        confirmedTime: null,
      };

    default:
      return data;
  }
}

// ---------------------------------------------------------------------------
// Timeline — drives the FSM forward by scheduling the next event.
//
// Each state declares a duration in ms. When the reducer enters a new state,
// this hook fires a setTimeout that dispatches the matching _DONE event.
//
// We deliberately do NOT use setInterval: each transition re-schedules
// itself, so if React suspends or a tab is backgrounded, the timeline
// resumes cleanly when the tab comes back.
//
// Subtle per-loop jitter: deterministic state sequence, but the CUSTOMER_-
// SELECTION pause is offset by a tiny seeded value so the loop doesn't
// feel mechanical on repeat views. Seeded from a counter so it stays
// deterministic across re-renders within the same loop.
// ---------------------------------------------------------------------------

interface StateDuration {
  state: DemoState;
  ms: number;
}

// Soft, natural-feeling pause timings. Not so fast it feels jumpy, not so
// slow the user gets bored. Total cycle ~9s + jitter.
const DURATIONS: Record<DemoState, number> = {
  IDLE: 0,                         // not used — START is immediate on first effect
  CUSTOMER_MESSAGE: 1100,          // ~1.1s for the customer bubble to read
  TYPING_AVAILABILITY: 900,        // ~0.9s typing
  AVAILABILITY_REPLY: 1500,        // ~1.5s for the bot reply + picker to register
  SLOT_PICKER: 0,                  // intermediate; we transition via TAP_SLOT
  CUSTOMER_SELECTION: 600,         // ~0.6s for the customer's reply bubble
  TYPING_BOOKING: 700,             // ~0.7s typing
  BOOKING_CONFIRMATION: 2200,      // ~2.2s for the confirmation to be read
  PAUSE: 500,                      // ~0.5s pause before reset — short enough
                                  // that the BOOKING_CONFIRMATION exit and the
                                  // next cycle's CUSTOMER_MESSAGE feel like a
                                  // continuous breathing rhythm, not a stop.
};

// Tiny seeded jitter — ±200ms. Using a counter keeps it deterministic across
// re-renders within the same loop but varies loop-to-loop so it doesn't feel
// mechanical on repeat views.
let loopCounter = 0;
function jitterMs(max = 200): number {
  // Mulberry32-ish LCG, but very small — only needs to be different per call.
  loopCounter = (loopCounter + 1) | 0;
  const x = Math.sin(loopCounter * 9301 + 49297) * 233280;
  const frac = x - Math.floor(x); // [0, 1)
  return Math.round((frac * 2 - 1) * max);
}

function useTimelineDriver(
  data: DemoData,
  reduced: boolean,
  dispatch: (e: DemoEvent) => void,
) {
  // Start the cycle once on mount.
  useEffect(() => {
    dispatch({ type: "START" });
  }, [dispatch]);

  // After every state change, schedule the next event.
  useEffect(() => {
    const base = DURATIONS[data.state];

    // SLOT_PICKER waits for the customer to tap — handled by the auto-tap
    // effect below, not by a timer.
    if (data.state === "SLOT_PICKER") return undefined;

    // No-op for IDLE (START drives it).
    if (data.state === "IDLE") return undefined;

    // Only CUSTOMER_SELECTION gets jitter — it's the moment a human would
    // pause and read, so a small natural variation here reads as realism
    // without making the cycle feel unpredictable.
    const ms =
      data.state === "CUSTOMER_SELECTION" ? Math.max(400, base + jitterMs(200)) : base;

    const timer = setTimeout(() => {
      switch (data.state) {
        case "CUSTOMER_MESSAGE":
          dispatch({ type: "CUSTOMER_MESSAGE_DONE" });
          break;
        case "TYPING_AVAILABILITY":
          dispatch({ type: "TYPING_AVAILABILITY_DONE" });
          break;
        case "CUSTOMER_SELECTION":
          dispatch({ type: "TYPING_BOOKING_DONE" });
          break;
        case "TYPING_BOOKING":
          dispatch({ type: "BOOKING_CONFIRMATION_DONE" });
          break;
        case "BOOKING_CONFIRMATION":
          dispatch({ type: "PAUSE_DONE" });
          break;
        case "PAUSE":
          // After pause, kick a fresh START. Only auto-restart if reduced-
          // motion is OFF — reduced users see the final state statically.
          if (!reduced) dispatch({ type: "START" });
          break;
      }
    }, ms);
    return () => clearTimeout(timer);
  }, [data.state, reduced, dispatch]);

  // Auto-tap the chosen slot ~0.5s after the picker appears, to demonstrate
  // the selection without requiring the visitor to actually tap.
  useEffect(() => {
    if (reduced) return;
    if (data.state !== "AVAILABILITY_REPLY") return;
    // Tiny seeded offset so the auto-tap also feels naturally varied.
    const t = setTimeout(
      () => dispatch({ type: "TAP_SLOT", slot: CHOSEN_SLOT }),
      1100 + jitterMs(180),
    );
    return () => clearTimeout(t);
  }, [data.state, reduced, dispatch]);
}

// ---------------------------------------------------------------------------
// Component tree
// ---------------------------------------------------------------------------

export function HeroProductDemo() {
  const prefersReducedMotion = useReducedMotion();
  const reduced = !!prefersReducedMotion;
  const [data, dispatch] = useReducer(reducer, initialData);

  useTimelineDriver(data, reduced, dispatch);

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <WhatsAppCard data={data} dispatch={dispatch} reduced={reduced} />
      <CalendarCard data={data} reduced={reduced} />
    </div>
  );
}

// ---- WhatsApp card --------------------------------------------------------

function WhatsAppCard({
  data,
  dispatch,
  reduced,
}: {
  data: DemoData;
  dispatch: (e: DemoEvent) => void;
  reduced: boolean;
}) {
  return (
    // Two different periods + offset so the cards never move in lock-step.
    // The WhatsApp card breathes faster; the calendar card breathes slower
    // and starts at a different phase. Together they read as two distinct
    // objects, not one synced composition.
    <FloatingCard reduced={reduced} amplitude={FLOAT_DISTANCE_PX} period={6.4} offset={0}>
      <ParallaxCard reduced={reduced} intensity={0.6}>
        <div className="relative rounded-3xl border border-border/70 bg-card p-4 shadow-luxe">
          {/* Header — same in every state, just the chat panel. */}
          <div className="flex items-center gap-3 border-b border-border/60 pb-3">
            <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-primary">
              <MessageCircle className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Recepta · Bella</div>
              <div className="flex items-center gap-1.5 text-[11px] text-primary">
                <motion.span
                  className="size-1.5 rounded-full bg-primary"
                  animate={reduced ? {} : { opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
                Online · Answering in Urdu
              </div>
            </div>
          </div>

          {/* Chat body. min-height so the card doesn't jump as messages appear/disappear. */}
          <div className="mt-4 flex min-h-[280px] flex-col gap-2.5">
            <AnimatePresence initial={false}>
              {/* Customer opening message — visible from CUSTOMER_MESSAGE onward. */}
              {stateAtLeast(data.state, "CUSTOMER_MESSAGE") && (
                <ChatBubble key="customer-1" side="customer" reduced={reduced}>
                  Assalam-o-Alaikum! Kal HydraFacial ka appointment mil sakta hai?
                </ChatBubble>
              )}

              {/* Typing indicator — between customer message and bot reply. */}
              {data.state === "TYPING_AVAILABILITY" && (
                <TypingDots key="typing-1" reduced={reduced} />
              )}

              {/* Bot's availability reply. */}
              {stateAtLeast(data.state, "AVAILABILITY_REPLY") && (
                <ChatBubble key="bot-1" side="bot" reduced={reduced}>
                  Walaikum Assalam! Kal 3:00 PM aur 5:30 PM available hain. Kaunsa suit karega?
                </ChatBubble>
              )}

              {/* Slot picker chips — appear right under the bot reply. */}
              {data.state === "AVAILABILITY_REPLY" && (
                <SlotPicker
                  key="picker"
                  slots={SLOT_OPTIONS}
                  onTap={(slot) => dispatch({ type: "TAP_SLOT", slot })}
                  reduced={reduced}
                />
              )}

              {/* Customer's selection bubble. */}
              {stateAtLeast(data.state, "CUSTOMER_SELECTION") && (
                <ChatBubble key="customer-2" side="customer" reduced={reduced}>
                  {CHOSEN_SLOT} chahiye 🌸
                </ChatBubble>
              )}

              {/* Second typing indicator — between selection and confirmation. */}
              {data.state === "TYPING_BOOKING" && (
                <TypingDots key="typing-2" reduced={reduced} />
              )}

              {/* Bot's confirmation bubble. */}
              {stateAtLeast(data.state, "BOOKING_CONFIRMATION") && (
                <ChatBubble key="bot-2" side="bot" reduced={reduced}>
                  Perfect! Booked for tomorrow {data.confirmedTime ?? CHOSEN_SLOT} with Ayesha.
                </ChatBubble>
              )}

              {/* Confirmation card. */}
              {data.state === "BOOKING_CONFIRMATION" && (
                <motion.div
                  key="confirmed-card"
                  layout
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0 }}
                  transition={{ type: "spring", stiffness: 240, damping: 28 }}
                  className="mt-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
                >
                  ✅ Booking confirmed · HydraFacial · Rs. 6,500
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] italic text-muted-foreground">
          Example conversation — your bot's tone is configurable.
        </p>
      </ParallaxCard>
    </FloatingCard>
  );
}

// ---- Calendar card --------------------------------------------------------

function CalendarCard({ data, reduced }: { data: DemoData; reduced: boolean }) {
  return (
    <FloatingCard
      reduced={reduced}
      amplitude={FLOAT_DISTANCE_PX + 1}
      period={8.7}
      offset={2.1}
    >
      <ParallaxCard reduced={reduced} intensity={0.4}>
        <div className="md:mt-10">
          <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-luxe">
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
              {CALENDAR_ROWS.map((row) => (
                <CalendarRowItem
                  key={row.time}
                  row={row}
                  // Highlight slots that the bot is offering.
                  isOffered={data.offeredSlots.includes(row.time)}
                  // Highlight (more strongly) the customer's selection.
                  isSelected={data.selectedTime === row.time}
                  // The strongest state: actually booked.
                  isBooked={data.confirmedTime === row.time}
                  reduced={reduced}
                />
              ))}
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] italic text-muted-foreground">
            Sample dashboard view.
          </p>
        </div>
      </ParallaxCard>
    </FloatingCard>
  );
}

function CalendarRowItem({
  row,
  isOffered,
  isSelected,
  isBooked,
  reduced,
}: {
  row: CalendarRow;
  isOffered: boolean;
  isSelected: boolean;
  isBooked: boolean;
  reduced: boolean;
}) {
  // Booked wins over selected which wins over offered.
  const highlight = isBooked ? "booked" : isSelected ? "selected" : isOffered ? "offered" : "none";

  // Targeted border tint per state. Idle rows keep their default tint so the
  // booking row is the ONLY thing that visually reacts.
  const borderColor =
    highlight === "booked"
      ? "oklch(0.55 0.13 165 / 0.55)"
      : highlight === "selected"
      ? "oklch(0.55 0.13 165 / 0.45)"
      : highlight === "offered"
      ? "oklch(0.55 0.13 165 / 0.22)"
      : "oklch(0.85 0.01 70 / 0.6)";

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 280, damping: 28 }}
      animate={
        reduced
          ? {}
          : {
              // Only the highlighted row scales. Idle rows stay at 1 so the
              // booking row reads as the moment of attention.
              scale: highlight === "none" ? 1 : 1.02,
              borderColor,
              // The booked row gets a tiny background tint that decays so
              // it settles into a calmer "confirmed" state rather than
              // staying loudly lit.
              backgroundColor:
                highlight === "booked"
                  ? "oklch(0.97 0.03 165 / 0.5)"
                  : "oklch(0.99 0.005 90 / 0.4)",
            }
      }
      className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-2.5"
    >
      <div className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">{row.time}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-medium">{row.service}</span>
          {isBooked && (
            <motion.span
              layout
              initial={reduced ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className="shrink-0 whitespace-nowrap rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary"
            >
              JUST BOOKED
            </motion.span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {row.stylist}
          {row.ai && !isBooked && (
            <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary">AI</span>
          )}
        </div>
      </div>
      <div className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", row.color)}>
        {row.price}
      </div>
    </motion.div>
  );
}

// ---- Calendar row definition (kept at the bottom for clarity) -------------

interface CalendarRow {
  time: string;
  service: string;
  stylist: string;
  price: string;
  color: string;
  ai?: boolean;
}

const CALENDAR_ROWS: CalendarRow[] = [
  { time: "10:00", service: "Women's Cut", stylist: "Sana K.", price: "Rs. 3,500", color: "bg-primary/10 text-primary" },
  { time: "12:30", service: "Gel Manicure", stylist: "Hira M.", price: "Rs. 2,800", color: "bg-rose-gold/20 text-[color:var(--rose-gold)]" },
  { time: "2:00",  service: "Hair Colour", stylist: "Zara A.", price: "Rs. 9,500", color: "bg-primary/10 text-primary" },
  { time: "5:30",  service: "HydraFacial", stylist: "New · WhatsApp", price: "Rs. 6,500", color: "bg-emerald-glow/15 text-primary", ai: true },
  { time: "7:00",  service: "Threading", stylist: "Mehak R.", price: "Rs. 1,200", color: "bg-rose-gold/20 text-[color:var(--rose-gold)]" },
];

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Returns true if `current` is at or past `target` in the FSM lifecycle. */
function stateAtLeast(current: DemoState, target: DemoState): boolean {
  const order: DemoState[] = [
    "IDLE",
    "CUSTOMER_MESSAGE",
    "TYPING_AVAILABILITY",
    "AVAILABILITY_REPLY",
    "SLOT_PICKER",
    "CUSTOMER_SELECTION",
    "TYPING_BOOKING",
    "BOOKING_CONFIRMATION",
    "PAUSE",
  ];
  return order.indexOf(current) >= order.indexOf(target);
}

function ChatBubble({
  side,
  reduced,
  children,
}: {
  side: "customer" | "bot";
  reduced: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      layout
      // A real WhatsApp message doesn't slide or scale — it just fades up a
      // hair. That's the "real, living software" feel the brief calls for.
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? undefined : { opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className={cn("flex", side === "customer" ? "justify-start" : "justify-end")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
          side === "customer"
            ? "rounded-bl-md bg-muted text-foreground"
            : "rounded-br-md bg-primary text-primary-foreground",
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}

function TypingDots({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      key="typing"
      layout
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduced ? undefined : { opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex justify-end"
    >
      <div className="flex items-center gap-1 rounded-2xl rounded-br-md bg-primary/80 px-3 py-2">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-primary-foreground/80"
            // Smaller amplitude, longer period — quiet, continuous, not theatrical.
            animate={reduced ? {} : { y: [0, -1.5, 0], opacity: [0.45, 0.95, 0.45] }}
            transition={{
              duration: 1.3,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.18,
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function SlotPicker({
  slots,
  onTap,
  reduced,
}: {
  slots: readonly string[];
  onTap: (slot: string) => void;
  reduced: boolean;
}) {
  return (
    <motion.div
      layout
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? undefined : { opacity: 0, y: 4 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="flex flex-wrap justify-end gap-2"
    >
      {slots.map((slot) => (
        <SlotChip key={slot} slot={slot} onTap={() => onTap(slot)} reduced={reduced} />
      ))}
    </motion.div>
  );
}

function SlotChip({
  slot,
  onTap,
  reduced,
}: {
  slot: string;
  onTap: () => void;
  reduced: boolean;
}) {
  // The chosen chip stays visually emphasized to draw the eye. Subtle scale
  // + ring pulse. The unchosen chip stays static.
  const isChosen = slot === CHOSEN_SLOT;
  return (
    <motion.button
      type="button"
      onClick={onTap}
      disabled={reduced}
      whileTap={reduced ? undefined : { scale: 0.95 }}
      animate={
        reduced
          ? {}
          : isChosen
          ? {
              scale: [1, 1.04, 1],
              boxShadow: [
                "0 0 0 0px oklch(0.55 0.13 165 / 0)",
                "0 0 0 3px oklch(0.55 0.13 165 / 0.18)",
                "0 0 0 0px oklch(0.55 0.13 165 / 0)",
              ],
            }
          : {}
      }
      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        isChosen
          ? "border-primary/60 bg-primary/12 text-primary"
          : "border-border/70 bg-background text-muted-foreground hover:border-primary/40 hover:text-primary",
      )}
    >
      {slot}
    </motion.button>
  );
}

// ---- Motion wrappers ------------------------------------------------------

function FloatingCard({
  children,
  reduced,
  amplitude,
  period,
  offset = 0,
}: {
  children: ReactNode;
  reduced: boolean;
  amplitude: number;
  period: number;
  offset?: number;
}) {
  if (reduced) return <div>{children}</div>;
  return (
    <motion.div
      animate={{ y: [0, -amplitude, 0, amplitude, 0] }}
      transition={{
        duration: period,
        ease: "easeInOut",
        repeat: Infinity,
        repeatType: "mirror",
        delay: offset,
      }}
      style={{ willChange: "transform" }}
    >
      {children}
    </motion.div>
  );
}

function ParallaxCard({
  children,
  reduced,
  intensity = 0.5,
}: {
  children: ReactNode;
  reduced: boolean;
  intensity?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // Spring smooths the parallax so it doesn't jitter.
  const sx = useSpring(x, { stiffness: 120, damping: 18, mass: 1 });
  const sy = useSpring(y, { stiffness: 120, damping: 18, mass: 1 });
  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: coarse)");
    setIsCoarse(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsCoarse(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    if (reduced || isCoarse) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    // Normalize cursor to [-1, 1] across the card, scale by PARALLAX_MAX_PX.
    const dx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const dy = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    x.set(dx * PARALLAX_MAX_PX * intensity);
    y.set(dy * PARALLAX_MAX_PX * intensity);
  };
  const handleLeave = () => {
    x.set(0);
    y.set(0);
  };

  if (reduced || isCoarse) {
    // Touch devices + reduced motion: no parallax, plain wrapper.
    return <div ref={ref}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ x: sx, y: sy, willChange: "transform" }}
    >
      {children}
    </motion.div>
  );
}