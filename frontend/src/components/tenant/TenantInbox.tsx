import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Search,
  Send,
  UserCog,
  Bot,
  CalendarCheck,
  CreditCard,
  CheckCircle2,
  Phone,
} from "lucide-react";

type Sender = "customer" | "ai" | "staff";

type Convo = {
  id: string;
  name: string;
  phone: string;
  snippet: string;
  time: string;
  intent: "Booking Request" | "Price Inquiry" | "Escalation" | "Timings";
  bucket: "active" | "human" | "done";
  slots: { service?: string; date?: string; staff?: string; name?: string };
  messages: { from: Sender; text: string; time: string }[];
};

const CONVOS: Convo[] = [
  {
    id: "c1",
    name: "Ayesha K.",
    phone: "+92 300 1234567",
    snippet: "Yes tomorrow 4 PM works, with Ali please",
    time: "2m",
    intent: "Booking Request",
    bucket: "active",
    slots: { name: "Ayesha K.", service: "Haircut", date: "Tomorrow 4:00 PM", staff: "Ali" },
    messages: [
      { from: "customer", text: "Hi, I want to book a haircut", time: "3:12 PM" },
      { from: "ai", text: "Hi Ayesha! Sure — we have Ali and Sara available tomorrow. Any time preference?", time: "3:12 PM" },
      { from: "customer", text: "4 PM with Ali", time: "3:14 PM" },
      { from: "ai", text: "Perfect, booking a Haircut with Ali tomorrow at 4:00 PM. Shall I confirm?", time: "3:14 PM" },
      { from: "customer", text: "Yes please", time: "3:15 PM" },
    ],
  },
  {
    id: "c2",
    name: "Hassan R.",
    phone: "+92 321 5551122",
    snippet: "Your prices are ridiculous, worst salon",
    time: "12m",
    intent: "Escalation",
    bucket: "human",
    slots: { name: "Hassan R." },
    messages: [
      { from: "customer", text: "What do you charge for beard trim?", time: "2:45 PM" },
      { from: "ai", text: "Beard trim is PKR 800.", time: "2:45 PM" },
      { from: "customer", text: "That's outrageous, worst salon in Lahore", time: "2:47 PM" },
    ],
  },
  {
    id: "c3",
    name: "Sana M.",
    phone: "+92 345 9998877",
    snippet: "How much is a manicure?",
    time: "24m",
    intent: "Price Inquiry",
    bucket: "active",
    slots: { name: "Sana M." },
    messages: [
      { from: "customer", text: "How much is a manicure?", time: "2:30 PM" },
      { from: "ai", text: "Classic manicure is PKR 1,500 (30 mins). Would you like to book?", time: "2:30 PM" },
    ],
  },
  {
    id: "c4",
    name: "Fatima Z.",
    phone: "+92 300 4443322",
    snippet: "Confirmed — see you Saturday",
    time: "1h",
    intent: "Booking Request",
    bucket: "done",
    slots: { name: "Fatima Z.", service: "Facial", date: "Sat 11:00 AM", staff: "Sara" },
    messages: [
      { from: "customer", text: "Book facial Saturday morning", time: "1:14 PM" },
      { from: "ai", text: "Booked: Facial with Sara, Saturday 11:00 AM.", time: "1:14 PM" },
      { from: "customer", text: "Confirmed — see you Saturday", time: "1:15 PM" },
    ],
  },
];

const intentColor: Record<Convo["intent"], string> = {
  "Booking Request": "bg-success-soft text-[oklch(0.35_0.12_145)] border-transparent",
  "Price Inquiry": "bg-accent text-accent-foreground border-transparent",
  Escalation: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
  Timings: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
};

export function TenantInbox() {
  const [tab, setTab] = useState<"active" | "human" | "done">("active");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>("c1");
  const [draft, setDraft] = useState("");
  const [takenOver, setTakenOver] = useState<Record<string, boolean>>({});

  const list = CONVOS.filter(
    (c) =>
      c.bucket === tab &&
      (query === "" ||
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.phone.includes(query)),
  );
  const active = CONVOS.find((c) => c.id === activeId) ?? CONVOS[0];
  const isTakenOver = !!takenOver[active.id];
  const humanCount = CONVOS.filter((c) => c.bucket === "human").length;

  return (
    <div className="h-[calc(100vh-4rem)] grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] bg-[oklch(0.985_0.003_200)]">
      {/* List column */}
      <div className="border-r bg-white flex flex-col min-h-0">
        <div className="p-4 border-b space-y-3">
          <h2 className="text-sm font-semibold">Inbox</h2>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 bg-background"
            />
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="w-full">
              <TabsTrigger value="active" className="flex-1 text-xs">Active AI</TabsTrigger>
              <TabsTrigger value="human" className="flex-1 text-xs gap-1.5">
                Takeover
                {humanCount > 0 && (
                  <Badge className="bg-destructive text-destructive-foreground border-transparent h-4 min-w-4 px-1 text-[10px]">
                    {humanCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="done" className="flex-1 text-xs">Completed</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No conversations.</div>
          ) : (
            <ul className="divide-y">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/60 transition-colors",
                      activeId === c.id && "bg-primary/5 border-l-2 border-primary",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm truncate">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground shrink-0">{c.time}</div>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{c.phone}</div>
                    <div className="mt-1 text-xs text-foreground/80 line-clamp-1">{c.snippet}</div>
                    <div className="mt-2">
                      <Badge className={cn("text-[10px] font-medium", intentColor[c.intent])}>
                        {c.intent}
                      </Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Chat thread */}
      <div className="flex flex-col min-h-0 bg-white border-r">
        <div className="p-4 border-b flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Phone className="size-4 text-muted-foreground" />
              {active.phone}
            </div>
            <div className="text-xs text-muted-foreground">{active.name}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.slots.service && (
                <Badge variant="outline" className="text-[10px]">Service: {active.slots.service}</Badge>
              )}
              {active.slots.date && (
                <Badge variant="outline" className="text-[10px]">Date: {active.slots.date}</Badge>
              )}
              {active.slots.staff && (
                <Badge variant="outline" className="text-[10px]">Staff: {active.slots.staff}</Badge>
              )}
            </div>
          </div>
          <Button
            onClick={() => setTakenOver((s) => ({ ...s, [active.id]: !s[active.id] }))}
            variant={isTakenOver ? "outline" : "default"}
            className={!isTakenOver ? "bg-primary hover:bg-primary/90" : ""}
          >
            <UserCog className="size-4" />
            {isTakenOver ? "Return to AI" : "Take Over Chat"}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {active.messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
          {isTakenOver && (
            <div className="text-center">
              <Badge className="bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent">
                AI paused — you are replying manually
              </Badge>
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-background/50">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={isTakenOver ? "Type your reply to the customer…" : "Take over to send a manual reply"}
              disabled={!isTakenOver}
              className="min-h-11 max-h-32 resize-none bg-white"
            />
            <Button
              disabled={!isTakenOver || !draft.trim()}
              onClick={() => setDraft("")}
              className="bg-primary hover:bg-primary/90"
            >
              <Send className="size-4" />
              Send
            </Button>
          </div>
        </div>
      </div>

      {/* Context panel */}
      <div className="bg-white flex flex-col min-h-0 overflow-y-auto">
        <div className="p-5 border-b">
          <h3 className="text-sm font-semibold">Extracted Details</h3>
          <p className="text-xs text-muted-foreground">Auto-captured by the AI agent.</p>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Name" value={active.slots.name ?? "—"} />
            <Row label="Service" value={active.slots.service ?? "—"} />
            <Row label="Date" value={active.slots.date?.split(" ").slice(0, -2).join(" ") ?? "—"} />
            <Row label="Time" value={active.slots.date?.split(" ").slice(-2).join(" ") ?? "—"} />
            <Row label="Staff" value={active.slots.staff ?? "—"} />
          </dl>
        </div>
        <div className="p-5 space-y-2">
          <h3 className="text-sm font-semibold mb-2">Quick Actions</h3>
          <Button variant="outline" className="w-full justify-start">
            <CalendarCheck className="size-4" /> Confirm Appointment in System
          </Button>
          <Button variant="outline" className="w-full justify-start">
            <CreditCard className="size-4" /> Send Payment Link
          </Button>
          <Button variant="outline" className="w-full justify-start">
            <CheckCircle2 className="size-4" /> Mark Resolved
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  );
}

function MessageBubble({ msg }: { msg: { from: Sender; text: string; time: string } }) {
  if (msg.from === "customer") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-tl-sm bg-muted text-foreground px-4 py-2 text-sm">
            {msg.text}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">{msg.time}</div>
        </div>
      </div>
    );
  }
  const isAI = msg.from === "ai";
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%]">
        <div
          className={cn(
            "rounded-2xl rounded-tr-sm px-4 py-2 text-sm",
            isAI ? "bg-primary text-primary-foreground" : "bg-[oklch(0.32_0.08_255)] text-white",
          )}
        >
          {msg.text}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
          <Badge
            className={cn(
              "h-4 px-1.5 text-[9px] border-transparent",
              isAI
                ? "bg-primary/10 text-primary"
                : "bg-[oklch(0.32_0.08_255)]/10 text-[oklch(0.32_0.08_255)]",
            )}
          >
            {isAI ? <><Bot className="size-2.5" /> AI</> : <><UserCog className="size-2.5" /> Staff</>}
          </Badge>
          {msg.time}
        </div>
      </div>
    </div>
  );
}