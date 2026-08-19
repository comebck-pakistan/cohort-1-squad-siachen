// ---------------------------------------------------------------------------
// GlobalNotificationBanner.tsx — the marquee that sits at the top of every
// authenticated dashboard (superadmin + salon-portal). Renders nothing when
// there's no active notification.
//
// Behavior:
//   - Polls /api/notifications/active every 60s
//   - Title + body scroll right-to-left, repeated 4 times for a seamless loop
//   - Animation duration is length-aware (longer text = slower scroll, more
//     readable). Clamped 40-120s.
//   - Pauses on hover/focus
//   - X button on the right hides the banner for the rest of the browser
//     session. Dismiss state is keyed on notification id + a per-browser
//     counter so creating a NEW notification resets dismissal.
//   - Respects prefers-reduced-motion
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, X } from "lucide-react";

import { api, qk } from "@/lib/api";
import type { NotificationRow, NotificationSeverity } from "@/types";

const SEVERITY_BG: Record<NotificationSeverity, string> = {
  info: "bg-info-soft",
  warning: "bg-warning-soft",
  critical: "bg-danger-soft",
};

const SEVERITY_FG: Record<NotificationSeverity, string> = {
  info: "text-[oklch(0.42_0.10_195)]",
  warning: "text-[oklch(0.4_0.12_85)]",
  critical: "text-[oklch(0.4_0.18_27)]",
};

const SEVERITY_ICON_BG: Record<NotificationSeverity, string> = {
  info: "bg-info text-info-foreground",
  warning: "bg-warning text-warning-foreground",
  critical: "bg-danger text-danger-foreground",
};

const DISMISS_KEY = "recepta.notifications.dismissed";

interface DismissState {
  /** Increments every time a new notification is observed. When the
   *  notification id changes, the counter increments and any prior dismiss
   *  is invalidated. */
  session: number;
  /** Map of notificationId -> session number at which the user dismissed it.
   *  When the current session counter exceeds the saved value, the banner
   *  is shown again (a new notification was created). */
  byId: Record<string, number>;
}

function loadDismissState(): DismissState {
  if (typeof localStorage === "undefined") return { session: 0, byId: {} };
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return { session: 0, byId: {} };
    const parsed = JSON.parse(raw);
    return {
      session: typeof parsed.session === "number" ? parsed.session : 0,
      byId: typeof parsed.byId === "object" && parsed.byId ? parsed.byId : {},
    };
  } catch {
    return { session: 0, byId: {} };
  }
}

function saveDismissState(state: DismissState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(state));
  } catch {
    // localStorage might be full or disabled; silently ignore.
  }
}

/**
 * Compute animation duration from the text length. Reads at ~12 chars/sec
 * is too fast on a 30-character sentence — bumped to ~6 chars/sec baseline,
 * clamped 40-120s so very short or very long text still feels intentional.
 */
function durationFor(text: string): number {
  const chars = text.length || 30;
  const sec = Math.round(chars / 6);
  return Math.max(40, Math.min(120, sec));
}

function formatMarqueeText(n: NotificationRow): string {
  return `${n.title}  —  ${n.body}`;
}

export function GlobalNotificationBanner() {
  const q = useQuery({
    queryKey: qk.notificationsActive,
    queryFn: () => api.getActiveNotification(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const [dismiss, setDismiss] = useState<DismissState>(loadDismissState);

  // Persist on every change.
  useEffect(() => {
    saveDismissState(dismiss);
  }, [dismiss]);

  const notification = q.data?.notification ?? null;

  // Track which notification id is currently "live" in the dismiss map. When
  // the id changes (new notification published), bump the session counter
  // so any prior dismiss for the OLD id is ignored and the NEW one shows.
  useEffect(() => {
    if (!notification) return;
    setDismiss((prev) => {
      if (prev.byId[notification.id] !== undefined) return prev;
      // First time seeing this id — bump session counter so old dismisses
      // for other ids are still respected but we know the latest id.
      return { ...prev, session: prev.session + 1 };
    });
  }, [notification?.id]);

  const dismissed = useMemo(() => {
    if (!notification) return false;
    const saved = dismiss.byId[notification.id];
    if (saved === undefined) return false;
    return saved >= dismiss.session;
  }, [notification, dismiss]);

  if (q.isError) return null;
  if (!notification || dismissed) return null;

  const text = formatMarqueeText(notification);
  const duration = durationFor(text);
  // 4 copies of the text — wide enough to always fill the viewport while
  // the translation wraps, with enough room for the eye to re-find the
  // start of the message after a full sweep.
  const repeated = Array.from({ length: 4 }, () => text).join("        •        ");

  const handleDismiss = () => {
    setDismiss((prev) => ({
      ...prev,
      byId: { ...prev.byId, [notification.id]: prev.session },
    }));
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative w-full overflow-hidden border-b border-border/60 ${SEVERITY_BG[notification.severity]} ${SEVERITY_FG[notification.severity]}`}
      style={{ "--marquee-duration": `${duration}s` } as React.CSSProperties}
    >
      <div className="group flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium">
        <span
          className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm ${SEVERITY_ICON_BG[notification.severity]}`}
          aria-hidden="true"
        >
          <Megaphone className="size-3" />
        </span>
        <div className="relative flex-1 overflow-hidden">
          <div
            className="marquee-track whitespace-nowrap group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]"
            style={{ minWidth: "300%" }}
          >
            {repeated}
          </div>
        </div>
        <span
          className="hidden sm:inline shrink-0 rounded-sm bg-background/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-foreground/70"
          aria-hidden="true"
        >
          {notification.severity}
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss notification for this session"
          title="Dismiss"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-background/40 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
