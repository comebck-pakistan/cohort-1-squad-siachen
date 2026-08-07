import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  CheckCheck,
} from "lucide-react";

// ---------------------------------------------------------------------------
// /salon-portal/inbox — Escalations tab (renamed 2026-08-07).
//
// Two sub-tabs inside this view:
//   - Active    — conversations that need human attention right now.
//                 Source: GET /api/business/:id/conversations
//                 (returns unresolved escalation_events OR
//                 human_takeover conversations).
//   - Resolved  — history view. Conversations whose latest escalation
//                 event is resolved=true, sorted by resolved_at desc.
//                 Source: GET /api/business/:id/resolved-escalations
//                 (added in Wave 2 to give the owner a place to look
//                 back at what got resolved).
//
// Why two tabs and not just one "Active only" list: at 100+ customers
// per day, the bot handles the vast majority on its own and the
// Escalations tab stays small. The owner wants BOTH a "what needs me
// now" queue AND a way to look back at "what did I close yesterday" —
// without either, they end up scrolling through a wall of dead rows
// looking for the live ones. Two tabs is the cleanest answer.
//
// Story 18 thread bubbles + take-over + send + mark-resolved are all
// in this single component; the only thing that changes between
// sub-tabs is the list endpoint + the right-column "Mark Resolved"
// button (hidden in Resolved).
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

/** Shape of a row from either conversations endpoint (active or
 *  resolved). We deliberately share the renderer between both
 *  sub-tabs so the bubble + context panel don't need to branch. */
interface NormalizedConvo {
  id: string;
  name: string;
  phone: string;
  snippet: string;
  /** Used in the right-side label for Active rows; falls back to
   *  last_message_at for Resolved rows when resolved_at is null. */
  time: string;
  intent: Intent;
  takenOver: boolean;
  nextAppointment: NextAppointment | null;
  /** ISO timestamp; only present on Resolved sub-tab rows. */
  resolvedAt: string | null;
  /** Latest escalation_events.id for this conversation. Present on
   *  both sub-tabs so Mark Resolved (Active) and any future
   *  re-escalate (Resolved) can target the right row. */
  latestEscalationId: string | null;
}

export function TenantInbox() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";
  const queryClient = useQueryClient();

  // Sub-tab state — defaults to Active so the owner lands on what
  // needs them.
  const [subTab, setSubTab] = useState<"active" | "resolved">("active");

  // Active sub-tab: latest unresolved escalations + human_takeovers.
  const activeQ = useQuery({
    queryKey: businessId ? qk.conversations(businessId) : ["conversations", "none"],
    queryFn: () => api.conversations(businessId),
    enabled: !!businessId && subTab === "active",
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Resolved sub-tab: latest-resolved escalations, sorted by
  // resolved_at desc. Same staleTime so the tab switch feels instant.
  const resolvedQ = useQuery({
    queryKey: businessId ? qk.resolvedEscalations(businessId) : ["resolved-escalations", "none"],
    queryFn: () => api.resolvedEscalations(businessId),
    enabled: !!businessId && subTab === "resolved",
    staleTime: 30_000,
    refetchInterval: 60_000, // history changes less often
  });

  const activeRaw = activeQ.data?.conversations ?? [];
  const resolvedRaw = resolvedQ.data?.conversations ?? [];

  const raw = subTab === "active" ? activeRaw : resolvedRaw;
  const isLoading = subTab === "active" ? activeQ.isLoading : resolvedQ.isLoading;

  // Normalize both shapes into a single NormalizedConvo so the
  // renderer doesn't have to branch. The Resolved endpoint carries
  // a `resolved_at` field; the Active endpoint doesn't, so we
  // synthesize null for it.
  const convos: NormalizedConvo[] = raw.map((c) => {
    const intent = classifyIntent(c.state?.current_intent);
    return {
      id: c.id,
      name: c.customer?.name || c.customer?.phone || "Unknown",
      phone: c.customer?.phone || "",
      snippet: c.state?.last_customer_msg || c.state?.last_agent_msg || "—",
      time:
        subTab === "resolved"
          ? fmtTimeAgo((c as { resolved_at?: string | null }).resolved_at ?? c.last_message_at)
          : fmtTimeAgo(c.last_message_at),
      intent,
      takenOver: c.status === "human_takeover",
      nextAppointment: (c.next_appointment as NextAppointment | null) ?? null,
      resolvedAt:
        subTab === "resolved"
          ? ((c as { resolved_at?: string | null }).resolved_at ?? null)
          : null,
      latestEscalationId:
        ((c as { latest_escalation_id?: string | null }).latest_escalation_id ?? null),
    };
  });

  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [takenOver, setTakenOver] = useState<Record<string, boolean>>({});

  // Search filters both sub-tabs identically. First-match wins as the
  // selected conversation when the list loads. Switching sub-tab
  // also clears the active selection so we don't land on a row that
  // doesn't exist in the new list.
  const filtered = convos.filter(
    (c) =>
      query === "" ||
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.phone.includes(query),
  );
  const active =
    convos.find((c) => c.id === activeId) ?? filtered[0] ?? null;
  const isTakenOver = active ? !!takenOver[active.id] : false;

  // -------------------------------------------------------------------------
  // Mark Resolved mutation.
  //
  // Hit POST /api/escalations/:id/resolve with the conversation's
  // latest escalation id, then invalidate BOTH the active list and
  // the resolved list so the row drops out of Active and appears in
  // Resolved on the next refresh.
  //
  // We optimistically remove from the active list immediately so the
  // UI feels instant — the row visibly disappears as soon as the
  // owner clicks Mark Resolved. If the POST fails we re-add it.
  // -------------------------------------------------------------------------
  const resolveMut = useMutation({
    mutationFn: (escalationId: string) => api.resolveEscalation(escalationId),
    onMutate: async (escalationId) => {
      await queryClient.cancelQueries({ queryKey: ["conversations", businessId] });
      const prev = queryClient.getQueryData<{ conversations: unknown[] }>(
        qk.conversations(businessId),
      );
      queryClient.setQueryData<{ conversations: unknown[] }>(
        qk.conversations(businessId),
        (old) =>
          old
            ? {
                conversations: old.conversations.filter(
                  // The active endpoint doesn't currently return
                  // latest_escalation_id (only resolved does), so
                  // we filter optimistically by conversation id
                  // matching the active selection.
                  (row) => (row as { id: string }).id !== active?.id,
                ),
              }
            : old,
      );
      return { prev, escalationId };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(qk.conversations(businessId), ctx.prev);
      }
    },
    onSettled: () => {
      // Re-fetch both lists so the Resolved sub-tab picks up the
      // newly-resolved row when the owner switches to it.
      queryClient.invalidateQueries({ queryKey: ["conversations", businessId] });
      queryClient.invalidateQueries({ queryKey: ["resolved-escalations", businessId] });
    },
  });

  // -------------------------------------------------------------------------
  // Owner reply mutation (Send button).
  //
  // POST /api/conversations/:id/owner-reply — backend persists the
  // owner turn FIRST (so the messages row exists even if bridge send
  // fails), then proxies the actual WhatsApp send through the
  // bridge. We surface the result in a small status line below the
  // textarea so the owner knows whether the customer actually got
  // the text.
  // -------------------------------------------------------------------------
  const replyMut = useMutation({
    mutationFn: ({ conversationId, text }: { conversationId: string; text: string }) =>
      api.ownerReply(conversationId, text),
    onSuccess: (res) => {
      // Clear the textarea either way; the message is logged.
      setDraft("");
      // Always refresh the thread (the new owner bubble is there)
      // and the conversation list (snippet updates).
      queryClient.invalidateQueries({
        queryKey: qk.conversationMessages(active!.id),
      });
      queryClient.invalidateQueries({ queryKey: ["conversations", businessId] });
      if (!res.sentToBridge) {
        // Non-fatal — message is persisted. Owner can re-send or
        // follow up via their phone. The status banner below the
        // textarea shows the warning.
      }
    },
  });

  // Story 18 — full conversation thread. Polls every 15s so an
  // incoming message from a customer shows up without a refresh.
  // MUST be declared after `active` (reads active?.id) to avoid TDZ.
  const threadQ = useQuery({
    queryKey: active ? qk.conversationMessages(active.id) : ["thread", "none"],
    queryFn: () => api.conversationMessages(active!.id),
    enabled: !!active,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  return (
    <div className="h-[calc(100vh-4rem)] grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] bg-[oklch(0.985_0.003_200)]">
      {/* List column */}
      <div className="border-r bg-white flex flex-col min-h-0">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Escalations</h2>
            {/* Compact Active/Resolved toggle. Sits in the header
                so it's always visible without taking vertical space. */}
            <div className="inline-flex rounded-md border bg-background p-0.5 text-[11px]">
              <button
                onClick={() => {
                  setSubTab("active");
                  setActiveId(null);
                }}
                className={cn(
                  "px-2.5 py-1 rounded-sm transition-colors",
                  subTab === "active"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Active
              </button>
              <button
                onClick={() => {
                  setSubTab("resolved");
                  setActiveId(null);
                }}
                className={cn(
                  "px-2.5 py-1 rounded-sm transition-colors",
                  subTab === "resolved"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Resolved
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            {subTab === "active"
              ? "Conversations that need your attention."
              : "History of resolved escalations."}
          </p>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 bg-background"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
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
                ? subTab === "active"
                  ? "No escalations — everything is being handled by the AI."
                  : "No resolved escalations yet."
                : "No escalations match your search."}
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
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {subTab === "resolved" && c.resolvedAt
                          ? `Resolved ${c.time} ago`
                          : c.time}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{c.phone}</div>
                    <div className="mt-1 text-xs text-foreground/80 line-clamp-1">{c.snippet}</div>
                    <div className="mt-2 flex items-center gap-1">
                      <Badge className={cn("text-[10px] font-medium", intentColor[c.intent])}>
                        {c.intent}
                      </Badge>
                      {subTab === "resolved" && (
                        <Badge className="text-[10px] font-medium bg-success-soft text-[oklch(0.35_0.12_145)] border-transparent">
                          Resolved
                        </Badge>
                      )}
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
              <div className="mt-1">Pick one from the list, or wait for the AI to flag one for your attention.</div>
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
              {/* Take Over Chat is only meaningful in the Active tab.
                  In the Resolved tab, the conversation is already
                  closed — the owner can still read the transcript but
                  sending a manual reply would re-open it, which we
                  want to prevent accidentally. */}
              {subTab === "active" && (
                <Button
                  onClick={() => setTakenOver((s) => ({ ...s, [active.id]: !s[active.id] }))}
                  variant={isTakenOver ? "outline" : "default"}
                  className={!isTakenOver ? "bg-primary hover:bg-primary/90" : ""}
                >
                  <UserCog className="size-4" />
                  {isTakenOver ? "Return to AI" : "Take Over Chat"}
                </Button>
              )}
              {subTab === "resolved" && (
                <Badge className="bg-success-soft text-[oklch(0.35_0.12_145)] border-transparent">
                  <CheckCheck className="size-3 mr-1" /> Resolved
                </Badge>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {threadQ.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className={`h-9 ${i % 2 === 0 ? "w-2/3" : "w-1/2 ml-auto"} rounded-2xl`}
                    />
                  ))}
                </div>
              ) : threadQ.isError ? (
                <div className="text-center text-sm text-muted-foreground py-6">
                  Could not load messages.
                </div>
              ) : (threadQ.data?.messages.length ?? 0) === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6">
                  No messages yet for this conversation.
                </div>
              ) : (
                threadQ.data!.messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))
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
              {/* Send box is only enabled in Active tab when the
                  owner has explicitly taken over the chat. Resolved
                  tab has no input box at all — the conversation is
                  closed. */}
              {subTab === "active" ? (
                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={isTakenOver ? "Type your reply to the customer…" : "Take over to send a manual reply"}
                      disabled={!isTakenOver || replyMut.isPending}
                      className="min-h-11 max-h-32 resize-none bg-white"
                    />
                    <Button
                      disabled={!isTakenOver || !draft.trim() || replyMut.isPending}
                      onClick={() =>
                        replyMut.mutate({ conversationId: active.id, text: draft.trim() })
                      }
                      className="bg-primary hover:bg-primary/90"
                    >
                      <Send className="size-4" />
                      {replyMut.isPending ? "Sending…" : "Send"}
                    </Button>
                  </div>
                  {/* Status banner surfaces bridge failures so the
                      owner knows the customer may not have received
                      the message. The row is still saved in messages
                      so they can re-send. */}
                  {replyMut.isSuccess && !replyMut.data.sentToBridge && (
                    <div className="text-[11px] text-warning-foreground bg-warning-soft rounded-md px-3 py-2">
                      Saved to inbox, but bridge is down — the customer may not have received this.
                    </div>
                  )}
                  {replyMut.isError && (
                    <div className="text-[11px] text-danger-foreground bg-danger-soft rounded-md px-3 py-2">
                      Send failed: {(replyMut.error as Error)?.message ?? "unknown error"}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground text-center py-2">
                  This conversation is resolved — start a new one from the customer's next message.
                </div>
              )}
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
            <Row
              label="Status"
              value={
                active
                  ? subTab === "resolved"
                    ? "Resolved"
                    : active.takenOver
                      ? "Taken over"
                      : "Escalated"
                  : "—"
              }
            />
            <Row
              label={subTab === "resolved" ? "Resolved" : "Last activity"}
              value={
                active
                  ? subTab === "resolved" && active.resolvedAt
                    ? `${fmtTimeAgo(active.resolvedAt)} ago`
                    : active.time
                  : "—"
              }
            />
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
          {/* Mark Resolved — only enabled in the Active sub-tab AND
              only when we actually have an escalation row to flip.
              (Conversations in the queue via human_takeover but
              without an escalation_event also show up here; for
              those, the button no-ops with a small note.) */}
          {subTab === "active" && (
            <Button
              variant="outline"
              className="w-full justify-start"
              disabled={!active?.latestEscalationId || resolveMut.isPending}
              onClick={() => {
                if (active?.latestEscalationId) {
                  resolveMut.mutate(active.latestEscalationId);
                }
              }}
              title={
                !active?.latestEscalationId
                  ? "This conversation was manually taken over — there is no formal escalation to resolve."
                  : undefined
              }
            >
              <CheckCircle2 className="size-4" />
              {resolveMut.isPending ? "Resolving…" : "Mark Resolved"}
            </Button>
          )}
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

// ---------------------------------------------------------------------------
// MessageBubble — Story 18 thread renderer.
//
// Three sender types map to two visual styles:
//   - 'customer'  → left-aligned, muted background (incoming)
//   - 'agent'     → right-aligned, primary background, with AI badge
//   - 'owner'     → right-aligned, primary background, with "You" badge
//
// Owner rows now actually render in production — the Send button in
// the inbox writes an 'owner' sender_type row through
// /api/conversations/:id/owner-reply and the thread poll picks it up
// within 15s. The Story 12/29 wiring that ships this round is
// POST /api/conversations/:id/owner-reply on the backend + the
// matching mutation in this file.
//
// Timestamp renders in Asia/Karachi via toLocaleString with explicit
// timezone, matching the rest of the dashboard's display conventions.
// ---------------------------------------------------------------------------
function MessageBubble({ message }: { message: import("@/lib/api").ConversationMessage }) {
  const isCustomer = message.sender_type === "customer";
  const isAgent = message.sender_type === "agent";
  const isOwner = message.sender_type === "owner";

  return (
    <div className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[75%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words",
            isCustomer
              ? "rounded-tl-sm bg-muted text-foreground"
              : "rounded-tr-sm bg-primary text-primary-foreground",
          )}
        >
          {message.content}
        </div>
        <div
          className={cn(
            "mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground",
            !isCustomer && "justify-end",
          )}
        >
          {isAgent && (
            <Badge className="bg-primary/10 text-primary border-transparent h-4 px-1.5 text-[9px]">
              <Bot className="size-2.5" /> AI
            </Badge>
          )}
          {isOwner && (
            <Badge className="bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent h-4 px-1.5 text-[9px]">
              You
            </Badge>
          )}
          <span>
            {new Date(message.created_at).toLocaleString("en-PK", {
              timeZone: "Asia/Karachi",
              hour: "2-digit",
              minute: "2-digit",
              day: "numeric",
              month: "short",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}