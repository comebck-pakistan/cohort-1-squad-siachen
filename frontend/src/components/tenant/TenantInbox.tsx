import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api, qk } from "@/lib/api";
import type { NextAppointment } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";
import {
  Search,
  Send,
  UserCog,
  Bot,
  CreditCard,
  CheckCircle2,
  Phone,
  MessagesSquare,
} from "lucide-react";

// ---------------------------------------------------------------------------
// /salon-portal/inbox — Conversations tab
//
// Conversations list comes from GET /api/business/:id/conversations (real
// Supabase data joined with customers + conversation_state). The chat
// thread for the selected conversation is rebuilt from the last_customer_msg
// + last_agent_msg snapshot in conversation_state — we don't yet have a
// "full thread" endpoint, so this is intentionally a 2-message preview
// until that lands. Empty states are honest ("no conversations yet") so
// fresh signups don't see fake Ayesha / Hassan / Sana entries.
// ---------------------------------------------------------------------------

type Intent = "Booking Request" | "Price Inquiry" | "Escalation" | "Timings" | "Other";

const intentColor: Record<Intent, string> = {
  "Booking Request": "bg-success-soft text-[oklch(0.35_0.12_145)] border-transparent",
  "Price Inquiry": "bg-accent text-accent-foreground border-transparent",
  Escalation: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
  Timings: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  Other: "bg-muted text-muted-foreground border-transparent",
};

function classifyIntent(raw: string | null | undefined): Intent {
  const r = (raw || "").toLowerCase();
  if (r.includes("book")) return "Booking Request";
  if (r.includes("price") || r.includes("cost")) return "Price Inquiry";
  if (r.includes("escalat")) return "Escalation";
  if (r.includes("time") || r.includes("hour") || r.includes("location")) return "Timings";
  return "Other";
}

function bucketFromStatus(status: string | undefined): "active" | "human" | "done" {
  if (!status) return "active";
  if (status === "active") return "active";
  if (status === "human_takeover" || status === "human") return "human";
  return "done";
}

function fmtTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

interface NormalizedConvo {
  id: string;
  name: string;
  phone: string;
  snippet: string;
  time: string;
  intent: Intent;
  bucket: "active" | "human" | "done";
  lastCustomer: string | null;
  lastAgent: string | null;
  nextAppointment: NextAppointment | null;
}

export function TenantInbox() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";

  const convosQ = useQuery({
    queryKey: businessId
      ? qk.conversations(businessId)
      : ["conversations", "none"],
    queryFn: () => api.conversations(businessId),
    enabled: !!businessId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const raw = convosQ.data?.conversations ?? [];
  const convos: NormalizedConvo[] = raw.map((c) => {
    const intent = classifyIntent(c.state?.current_intent);
    return {
      id: c.id,
      name: c.customer?.name || c.customer?.phone || "Unknown",
      phone: c.customer?.phone || "",
      snippet: c.state?.last_customer_msg || c.state?.last_agent_msg || "—",
      time: fmtTimeAgo(c.last_message_at),
      intent,
      bucket: bucketFromStatus(c.status),
      lastCustomer: c.state?.last_customer_msg ?? null,
      lastAgent: c.state?.last_agent_msg ?? null,
      nextAppointment: c.next_appointment ?? null,
    };
  });

  const [tab, setTab] = useState<"active" | "human" | "done">("active");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [takenOver, setTakenOver] = useState<Record<string, boolean>>({});

  // Pick first matching conversation as the active one when the list loads.
  const filtered = convos.filter(
    (c) =>
      c.bucket === tab &&
      (query === "" ||
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.phone.includes(query)),
  );
  const active =
    convos.find((c) => c.id === activeId) ?? filtered[0] ?? null;
  const isTakenOver = active ? !!takenOver[active.id] : false;
  const humanCount = convos.filter((c) => c.bucket === "human").length;

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
          {convosQ.isLoading ? (
            <ul className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="px-4 py-3 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-full" />
                </li>
              ))}
            </ul>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {convos.length === 0
                ? "No conversations yet. Once customers message your WhatsApp, they show up here."
                : "No conversations in this view."}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/60 transition-colors",
                      active?.id === c.id && "bg-primary/5 border-l-2 border-primary",
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
        {!active ? (
          <div className="flex-1 grid place-items-center p-6 text-center text-sm text-muted-foreground">
            <div>
              <MessagesSquare className="size-10 mx-auto mb-3 opacity-40" />
              <div className="font-medium text-foreground">No conversation selected</div>
              <div className="mt-1">Pick one from the inbox, or wait for a customer to message your WhatsApp.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 border-b flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Phone className="size-4 text-muted-foreground" />
                  {active.phone || "—"}
                </div>
                <div className="text-xs text-muted-foreground">{active.name}</div>
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
              {active.lastCustomer && (
                <div className="flex justify-start">
                  <div className="max-w-[75%]">
                    <div className="rounded-2xl rounded-tl-sm bg-muted text-foreground px-4 py-2 text-sm">
                      {active.lastCustomer}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{active.time}</div>
                  </div>
                </div>
              )}
              {active.lastAgent && (
                <div className="flex justify-end">
                  <div className="max-w-[75%]">
                    <div className="rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2 text-sm">
                      {active.lastAgent}
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
                      <Badge className="bg-primary/10 text-primary border-transparent h-4 px-1.5 text-[9px]">
                        <Bot className="size-2.5" /> AI
                      </Badge>
                      {active.time}
                    </div>
                  </div>
                </div>
              )}
              {!active.lastCustomer && !active.lastAgent && (
                <div className="text-center text-sm text-muted-foreground py-6">
                  No messages yet for this conversation.
                </div>
              )}
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
          </>
        )}
      </div>

      {/* Context panel */}
      <div className="bg-white flex flex-col min-h-0 overflow-y-auto">
        <div className="p-5 border-b">
          <h3 className="text-sm font-semibold">Extracted Details</h3>
          <p className="text-xs text-muted-foreground">Auto-captured by the AI agent.</p>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Name" value={active?.name ?? "—"} />
            <Row label="Phone" value={active?.phone ?? "—"} />
            <Row label="Intent" value={active?.intent ?? "—"} />
            <Row label="Status" value={active?.bucket ?? "—"} />
            <Row label="Last activity" value={active?.time ?? "—"} />
          </dl>
        </div>
        <div className="p-5 space-y-2">
          <h3 className="text-sm font-semibold mb-2">Quick Actions</h3>
          {active?.nextAppointment && (
            <div className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2 mb-2">
              <div className="font-medium text-foreground mb-1">
                Upcoming booking
              </div>
              {active.nextAppointment.service_name ?? "appointment"}
              {active.nextAppointment.staff_name && (
                <> · {active.nextAppointment.staff_name}</>
              )}{" "}
              ·{" "}
              {new Date(active.nextAppointment.start_time).toLocaleString(
                "en-PK",
                { timeZone: "Asia/Karachi", weekday: "short", hour: "2-digit", minute: "2-digit" },
              )}
            </div>
          )}
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
