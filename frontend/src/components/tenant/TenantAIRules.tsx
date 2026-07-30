import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  Plus,
  Send,
  Trash2,
  Bot,
  User,
  Save,
} from "lucide-react";
import { api, qk } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";

export function TenantAIRules() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";
  const qc = useQueryClient();

  // Load saved rules from backend on mount; falls back to safe defaults if
  // the business row has never been edited.
  const rulesQ = useQuery({
    queryKey: businessId ? qk.aiRules(businessId) : ["ai-rules", "none"],
    queryFn: () => api.aiRules(businessId),
    enabled: !!businessId,
    staleTime: 60_000,
  });

  const [discountMode, setDiscountMode] = useState<"decline" | "promo">("promo");
  const [latePolicy, setLatePolicy] = useState("");
  const [rules, setRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState("");
  const [triggers, setTriggers] = useState({
    complaint: true,
    ownerNumber: true,
    twoMisunderstands: true,
    refund: false,
    afterHours: false,
  });
  const [enabled, setEnabled] = useState({ discounts: true, late: true, custom: true });

  // Sync fetched rules into local form state on first successful load.
  useEffect(() => {
    const r = rulesQ.data;
    if (!r) return;
    setRules(r.rules);
    setDiscountMode(r.discountMode);
    setLatePolicy(r.latePolicy);
    setEnabled({
      discounts: r.triggers.discounts,
      late: r.triggers.late,
      custom: r.triggers.custom,
    });
  }, [rulesQ.data]);

  const save = useMutation({
    mutationFn: () =>
      api.updateAiRules(businessId, {
        rules,
        triggers: {
          discounts: enabled.discounts,
          late: enabled.late,
          custom: enabled.custom,
        },
        discountMode,
        latePolicy,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.aiRules(businessId) });
      toast.success("AI rules saved");
    },
    onError: (e) => toast.error((e as Error).message || "Save failed"),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Agent Rules & Guardrails</h1>
          <p className="text-sm text-muted-foreground">
            Salon-specific behavior. Test changes in the sandbox before saving.
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
          <Sandbox />
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Custom Edge Cases
        </h2>

        <Card className="border shadow-none bg-white">
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base">Discount Requests</CardTitle>
            <Switch
              checked={enabled.discounts}
              onCheckedChange={(v) => setEnabled({ ...enabled, discounts: v })}
            />
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={discountMode}
              onValueChange={(v) => setDiscountMode(v as typeof discountMode)}
              className="space-y-2"
              disabled={!enabled.discounts}
            >
              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="decline" id="d1" />
                <div>
                  <div className="text-sm font-medium">Strictly decline discounts</div>
                  <div className="text-xs text-muted-foreground">
                    AI politely refuses and steers back to full-price booking.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="promo" id="d2" />
                <div>
                  <div className="text-sm font-medium">
                    Offer standard 10% promo code:{" "}
                    <Badge className="bg-primary/10 text-primary border-transparent font-mono">
                      WELCOME10
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    AI shares once per conversation.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </CardContent>
        </Card>

        <Card className="border shadow-none bg-white">
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base">Late Arrival Policy</CardTitle>
            <Switch
              checked={enabled.late}
              onCheckedChange={(v) => setEnabled({ ...enabled, late: v })}
            />
          </CardHeader>
          <CardContent>
            <Textarea
              value={latePolicy}
              onChange={(e) => setLatePolicy(e.target.value)}
              className="min-h-20"
              disabled={!enabled.late}
            />
          </CardContent>
        </Card>

        <Card className="border shadow-none bg-white">
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base">Custom Salon Rules</CardTitle>
            <Switch
              checked={enabled.custom}
              onCheckedChange={(v) => setEnabled({ ...enabled, custom: v })}
            />
          </CardHeader>
          <CardContent className="space-y-2">
            {rules.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
              >
                <Input
                  value={r}
                  onChange={(e) =>
                    setRules((s) => s.map((x, j) => (i === j ? e.target.value : x)))
                  }
                  className="border-0 shadow-none focus-visible:ring-0 p-0 h-auto bg-transparent"
                  disabled={!enabled.custom}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setRules((s) => s.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="Add another rule…"
                value={newRule}
                onChange={(e) => setNewRule(e.target.value)}
                disabled={!enabled.custom}
              />
              <Button
                onClick={() => {
                  if (!newRule.trim()) return;
                  setRules((s) => [...s, newRule.trim()]);
                  setNewRule("");
                }}
                disabled={!enabled.custom || !newRule.trim()}
                className="bg-primary hover:bg-primary/90"
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Human Escalation Triggers
        </h2>
        <Card className="border shadow-none bg-white">
          <CardContent className="p-5 space-y-3">
            <TriggerRow
              checked={triggers.complaint}
              onChange={(v) => setTriggers({ ...triggers, complaint: v })}
              label="Customer mentions a complaint or bad experience"
            />
            <TriggerRow
              checked={triggers.ownerNumber}
              onChange={(v) => setTriggers({ ...triggers, ownerNumber: v })}
              label="Customer asks for the owner's personal number"
            />
            <TriggerRow
              checked={triggers.twoMisunderstands}
              onChange={(v) => setTriggers({ ...triggers, twoMisunderstands: v })}
              label="AI fails to understand customer prompt 2 times in a row"
            />
            <TriggerRow
              checked={triggers.refund}
              onChange={(v) => setTriggers({ ...triggers, refund: v })}
              label="Customer requests a refund"
            />
            <TriggerRow
              checked={triggers.afterHours}
              onChange={(v) => setTriggers({ ...triggers, afterHours: v })}
              label="Booking requested outside operating hours"
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function TriggerRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-md hover:bg-muted/50 p-2 cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function Sandbox() {
  const [msgs, setMsgs] = useState<{ from: "user" | "ai"; text: string }[]>([
    {
      from: "ai",
      text:
        "Hi! I'm your AI agent preview. Type a customer message on the left and see how I'd respond with your current rules.",
    },
  ]);
  const [input, setInput] = useState("Can I get a haircut for half price?");

  function send() {
    if (!input.trim()) return;
    const q = input.trim();
    setMsgs((s) => [...s, { from: "user", text: q }]);
    setInput("");
    setTimeout(() => {
      const reply = mockReply(q);
      setMsgs((s) => [...s, { from: "ai", text: reply }]);
    }, 300);
  }

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
            <FlaskConical className="size-4 text-primary" /> System Prompt Sandbox
          </SheetTitle>
          <SheetDescription>
            Preview how your AI agent replies with the current rules — no messages are sent to real customers.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[oklch(0.985_0.003_200)]">
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
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a test customer message…"
              className="min-h-11 max-h-32 resize-none bg-background"
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

function mockReply(q: string): string {
  const l = q.toLowerCase();
  if (l.includes("half price") || l.includes("discount") || l.includes("cheap")) {
    return "Thanks for reaching out! We can't offer half price, but I'd be happy to share our WELCOME10 code for 10% off your first booking. Would you like me to apply it?";
  }
  if (l.includes("owner") || l.includes("manager")) {
    return "Let me connect you with a team member — I'll flag this chat for our manager now.";
  }
  if (l.includes("book") || l.includes("appointment")) {
    return "Absolutely — what service and time works for you? We're open 10 AM–8 PM Mon–Sat.";
  }
  return "I'd be glad to help with that! Could you share a bit more detail so I can point you to the right service?";
}