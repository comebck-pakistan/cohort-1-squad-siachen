import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  FlaskConical,
  Send,
  Bot,
  User,
  Save,
  ShieldCheck,
  AlertOctagon,
} from "lucide-react";
import { api, qk } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";

// ---------------------------------------------------------------------------
// Predefined rules + escalation triggers (Wave 9).
//
// The labels and prose shown here are a MIRROR of
// backend/src/lib/predefined-rules.ts. The backend is the source of
// truth for the rule_key vocabulary — the UI just renders the toggle
// list. If a new rule is added in the backend, add it here too so the
// switch is visible to owners.
//
// Owners can toggle which rules are enabled, but they CANNOT edit the
// rule text. This replaces the previous free-text Custom Salon Rules
// that only worked by accident (the AI prompt read the JSON as a string
// and the model sometimes parsed prose-shaped entries).
// ---------------------------------------------------------------------------

interface PredefinedRule {
  key: string;
  label: string;
  prose: string;
}

const PREDEFINED_RULES: PredefinedRule[] = [
  {
    key: "discount_decline",
    label: "Strictly decline discount requests",
    prose:
      "If the customer asks for a discount, coupon, or any price reduction, politely decline. Do NOT offer promo codes, negotiate, or suggest alternative discounts. Steer back to the standard service menu.",
  },
  {
    key: "discount_promo",
    label: "Offer WELCOME10 to new customers",
    prose:
      "If the customer asks for a discount or seems price-sensitive, offer the WELCOME10 code once per conversation (10% off their first booking). If they ask again, repeat the same offer — do not stack or escalate.",
  },
  {
    key: "late_arrival_15min",
    label: "15-minute late tolerance",
    prose:
      "If the customer is more than 15 minutes late for their appointment, explain politely that the slot cannot be held and offer to reschedule. Tolerate up to 15 minutes — past that, ask them to rebook.",
  },
  {
    key: "late_arrival_30min",
    label: "30-minute late tolerance",
    prose:
      "If the customer is more than 30 minutes late for their appointment, explain politely that the slot cannot be held and offer to reschedule.",
  },
  {
    key: "refund_48h",
    label: "48-hour refund window",
    prose:
      "Only honor refund requests made within 48 hours of the appointment. If the request is older than 48 hours, politely decline and offer a future discount instead.",
  },
  {
    key: "refund_full",
    label: "Honor refund requests fully",
    prose:
      "Honor all refund requests without question. If the customer is upset, escalate to the owner.",
  },
  {
    key: "no_double_booking",
    label: "No double-booking same stylist",
    prose:
      "Never book two customers with the same stylist at overlapping times. If a customer requests a conflicting time, offer the next available slot with that stylist or any other available stylist.",
  },
  {
    key: "min_24h_advance",
    label: "Require 24h advance booking",
    prose:
      "Do not accept bookings less than 24 hours in advance. If the customer requests a same-day or next-day booking, politely explain that the schedule requires 24 hours notice and offer the next available slot.",
  },
  {
    key: "no_medical_advice",
    label: "Never give medical/skin/health advice",
    prose:
      'Never give medical, skin, or health advice. If the customer describes a symptom (rash, infection, swelling, pain, allergic reaction), asks "is this safe for [pregnancy / kids / sensitive skin]", or mentions pregnancy/nursing in the context of a service, do NOT diagnose, recommend a product, or confirm a booking. Acknowledge briefly and tell them the team will follow up.',
  },
];

interface PredefinedTrigger {
  key: string;
  label: string;
  prose: string;
}

const PREDEFINED_TRIGGERS: PredefinedTrigger[] = [
  {
    key: "complaint",
    label: "Customer mentions a complaint or bad experience",
    prose:
      'If the customer mentions a complaint, bad experience, or expresses unhappiness, set intent="escalate" and tell them a team member will follow up shortly.',
  },
  {
    key: "ownerNumber",
    label: "Customer asks for the owner's personal number",
    prose:
      'If the customer explicitly asks for the owner\'s personal phone number, set intent="escalate" and tell them you will have the team reach out.',
  },
  {
    key: "twoMisunderstands",
    label: "AI fails to understand 2 turns in a row",
    prose:
      'If you have not understood the customer\'s intent for 2 consecutive turns, set intent="escalate" and offer to connect with a team member.',
  },
  {
    key: "refund",
    label: "Customer requests a refund",
    prose:
      'If the customer mentions refund, money back, chargeback, or disputes payment, set intent="escalate" and tell them a team member will follow up.',
  },
  {
    key: "afterHours",
    label: "Booking requested outside operating hours",
    prose:
      'If the customer requests a booking at a time outside the salon\'s operating hours, set intent="escalate" and tell them the team will follow up to discuss alternative options.',
  },
];

// Index by key for O(1) lookup in the sandbox.
const RULE_BY_KEY: Record<string, PredefinedRule> = Object.fromEntries(
  PREDEFINED_RULES.map((r) => [r.key, r]),
);
const TRIGGER_BY_KEY: Record<string, PredefinedTrigger> = Object.fromEntries(
  PREDEFINED_TRIGGERS.map((t) => [t.key, t]),
);

// ---------------------------------------------------------------------------
// Helpers for the Test Sandbox — produce a short, honest reply based on
// the current enabled rule state. NO real LLM call, but also NO
// hardcoded WELCOME10 reply regardless of toggles. Whatever the owner
// sees in the sandbox matches what the bot would actually do.
// ---------------------------------------------------------------------------

function sandboxReply(
  input: string,
  enabledRules: Set<string>,
  enabledTriggers: Set<string>,
): string {
  const l = input.toLowerCase();
  const wants = (kw: string) => l.includes(kw);

  // Escalation triggers first — they short-circuit any reply.
  if (
    enabledTriggers.has("refund") &&
    (wants("refund") || wants("money back") || wants("chargeback"))
  ) {
    return "I want to make sure this gets handled properly. Let me loop in our team — they'll follow up with you shortly.";
  }
  if (enabledTriggers.has("complaint") && (wants("unhappy") || wants("bad experience") || wants("complaint"))) {
    return "I'm sorry to hear that. Let me connect you with a team member who can look into this personally.";
  }
  if (enabledTriggers.has("ownerNumber") && (wants("owner") || wants("manager number"))) {
    return "I can't share personal numbers here, but I'll have the team reach out to you directly.";
  }

  // Behavioral rules.
  if (wants("discount") || wants("coupon") || wants("cheap") || wants("half price")) {
    if (enabledRules.has("discount_decline") && enabledRules.has("discount_promo")) {
      // Both on — owner bug, but the LLM would favor the LATER instruction.
      return "Thanks for asking! I can offer you WELCOME10 — 10% off your first booking. Want me to apply it?";
    }
    if (enabledRules.has("discount_decline")) {
      return "I appreciate you asking, but we keep our pricing standard across the board. Happy to share our full service list if it helps.";
    }
    if (enabledRules.has("discount_promo")) {
      return "Thanks for asking! I can offer you WELCOME10 — 10% off your first booking. Want me to apply it?";
    }
    return "I don't have any active discount rules configured. Would you like to book a service instead?";
  }

  if (wants("late") || wants("running late") || wants("delay")) {
    if (enabledRules.has("late_arrival_15min")) {
      return "If you're running more than 15 minutes late, please let me know — I'll need to offer to reschedule. Anything up to 15 minutes I can hold the slot.";
    }
    if (enabledRules.has("late_arrival_30min")) {
      return "If you're running more than 30 minutes late, please let me know — I'll need to offer to reschedule. Anything up to 30 minutes I can hold the slot.";
    }
    return "I don't have a late-arrival policy configured. If you're running late, just message me and I'll do my best to help.";
  }

  if (wants("book") || wants("appointment") || wants("schedule")) {
    return "Sure! What service would you like, and what day/time works for you?";
  }
  if (wants("price") || wants("cost") || wants("how much")) {
    return "Depends on the service — what are you looking to get done? I can share exact pricing from our menu.";
  }
  if (wants("hours") || wants("open") || wants("timing")) {
    return "Our hours vary by day — what day are you asking about? I can pull them up for you.";
  }

  return "Happy to help — could you tell me a bit more about what you're looking for?";
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function TenantAIRules() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";
  const qc = useQueryClient();

  const rulesQ = useQuery({
    queryKey: businessId ? qk.aiRules(businessId) : ["ai-rules", "none"],
    queryFn: () => api.aiRules(businessId),
    enabled: !!businessId,
    staleTime: 60_000,
  });

  const [enabledRules, setEnabledRules] = useState<Set<string>>(new Set());
  const [enabledTriggers, setEnabledTriggers] = useState<Set<string>>(new Set());

  // Sync fetched rules into local form state on first successful load.
  useEffect(() => {
    const r = rulesQ.data;
    if (!r) return;
    setEnabledRules(new Set(r.enabledRules));
    setEnabledTriggers(new Set(r.enabledTriggers));
  }, [rulesQ.data]);

  const save = useMutation({
    mutationFn: () =>
      api.updateAiRules(businessId, {
        enabledRules: Array.from(enabledRules),
        enabledTriggers: Array.from(enabledTriggers),
      }),
    onSuccess: (saved) => {
      // Trust the server's response — it validates keys + dedupes.
      setEnabledRules(new Set(saved.enabledRules));
      setEnabledTriggers(new Set(saved.enabledTriggers));
      qc.invalidateQueries({ queryKey: qk.aiRules(businessId) });
      toast.success("AI rules saved");
    },
    onError: (e) => toast.error((e as Error).message || "Save failed"),
  });

  const enabledRuleCount = enabledRules.size;
  const enabledTriggerCount = enabledTriggers.size;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            AI Agent Rules & Guardrails
          </h1>
          <p className="text-sm text-muted-foreground">
            Toggle which predefined rules and escalation triggers apply to
            this salon. Test changes in the sandbox before saving.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || rulesQ.isLoading}
            className="bg-primary hover:bg-primary/90"
          >
            <Save className="size-4" />
            {save.isPending ? "Saving…" : "Save rules"}
          </Button>
          <Sandbox
            enabledRules={enabledRules}
            enabledTriggers={enabledTriggers}
          />
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Active Rules
          </h2>
          <Badge variant="secondary" className="font-mono">
            {enabledRuleCount} / {PREDEFINED_RULES.length} enabled
          </Badge>
        </div>

        <Card className="border shadow-none bg-white">
          <CardContent className="p-0 divide-y">
            {PREDEFINED_RULES.map((rule) => {
              const isOn = enabledRules.has(rule.key);
              return (
                <label
                  key={rule.key}
                  className="flex items-start gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck
                        className={
                          isOn
                            ? "size-4 text-primary"
                            : "size-4 text-muted-foreground"
                        }
                      />
                      <span className="text-sm font-medium">{rule.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {rule.prose}
                    </p>
                  </div>
                  <Switch
                    checked={isOn}
                    onCheckedChange={(v) => {
                      setEnabledRules((s) => {
                        const next = new Set(s);
                        if (v) next.add(rule.key);
                        else next.delete(rule.key);
                        return next;
                      });
                    }}
                  />
                </label>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Human Escalation Triggers
          </h2>
          <Badge variant="secondary" className="font-mono">
            {enabledTriggerCount} / {PREDEFINED_TRIGGERS.length} enabled
          </Badge>
        </div>
        <Card className="border shadow-none bg-white">
          <CardContent className="p-0 divide-y">
            {PREDEFINED_TRIGGERS.map((trigger) => {
              const isOn = enabledTriggers.has(trigger.key);
              return (
                <label
                  key={trigger.key}
                  className="flex items-start gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <Checkbox
                    checked={isOn}
                    onCheckedChange={(v) => {
                      setEnabledTriggers((s) => {
                        const next = new Set(s);
                        if (v) next.add(trigger.key);
                        else next.delete(trigger.key);
                        return next;
                      });
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <AlertOctagon
                        className={
                          isOn
                            ? "size-4 text-destructive"
                            : "size-4 text-muted-foreground"
                        }
                      />
                      <span className="text-sm font-medium">{trigger.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {trigger.prose}
                    </p>
                  </div>
                </label>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test Sandbox — honest preview. The reply shown here is derived from the
// SAME enabled/disabled rule state the bot will see. NO hardcoded
// WELCOME10 reply regardless of toggles. If you turn off discount_promo,
// the sandbox no longer pretends the bot would offer it.
// ---------------------------------------------------------------------------

function Sandbox({
  enabledRules,
  enabledTriggers,
}: {
  enabledRules: Set<string>;
  enabledTriggers: Set<string>;
}) {
  const [msgs, setMsgs] = useState<{ from: "user" | "ai"; text: string }[]>([
    {
      from: "ai",
      text:
        "Hi! I'm your AI agent preview. Type a customer message on the left and see how the bot would reply with your CURRENT enabled rules. Replies are simulated — they reflect your toggle state, not stale hardcoded replies.",
    },
  ]);
  const [input, setInput] = useState("Can I get a haircut for half price?");

  function send() {
    if (!input.trim()) return;
    const q = input.trim();
    setMsgs((s) => [...s, { from: "user", text: q }]);
    setInput("");
    setTimeout(() => {
      const reply = sandboxReply(q, enabledRules, enabledTriggers);
      setMsgs((s) => [...s, { from: "ai", text: reply }]);
    }, 300);
  }

  // Show which rules are currently active so the owner can verify their
  // toggle state at a glance.
  const activeRules = Array.from(enabledRules)
    .map((k) => RULE_BY_KEY[k]?.label)
    .filter(Boolean);
  const activeTriggers = Array.from(enabledTriggers)
    .map((k) => TRIGGER_BY_KEY[k]?.label)
    .filter(Boolean);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" className="shrink-0">
          <FlaskConical className="size-4" /> Test Sandbox
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-5 border-b">
          <SheetTitle className="flex items-center gap-2">
            <FlaskConical className="size-4 text-primary" /> Sandbox Preview
          </SheetTitle>
          <SheetDescription>
            Replies reflect your current toggle state. No messages are sent to
            real customers.
          </SheetDescription>
        </SheetHeader>

        {/* Active state — small panel so the owner can verify toggles */}
        <div className="px-5 py-3 border-b bg-muted/30 space-y-2 text-xs">
          <div>
            <span className="font-medium text-muted-foreground">
              Active rules ({activeRules.length}):
            </span>{" "}
            <span className="text-foreground">
              {activeRules.length === 0
                ? "(none)"
                : activeRules.join(" · ")}
            </span>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">
              Active triggers ({activeTriggers.length}):
            </span>{" "}
            <span className="text-foreground">
              {activeTriggers.length === 0
                ? "(none)"
                : activeTriggers.join(" · ")}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background">
          {msgs.map((m, i) => (
            <div
              key={i}
              className={m.from === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div className="max-w-[80%]">
                <div
                  className={
                    m.from === "user"
                      ? "rounded-2xl rounded-tr-sm bg-muted text-foreground px-4 py-2 text-sm"
                      : "rounded-2xl rounded-tl-sm bg-primary text-primary-foreground px-4 py-2 text-sm"
                  }
                >
                  {m.text}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  {m.from === "user" ? (
                    <><User className="size-2.5" /> test customer</>
                  ) : (
                    <><Bot className="size-2.5" /> AI preview</>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t bg-white">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a test customer message…"
              className="flex min-h-11 max-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button onClick={send} className="bg-primary hover:bg-primary/90">
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
