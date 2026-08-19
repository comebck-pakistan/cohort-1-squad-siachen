-- ---------------------------------------------------------------------------
-- Wave 20 — Global Notifications
--
-- Adds the `global_notifications` table that powers the marquee banner
-- across every authenticated dashboard (superadmin + tenants). Mirrors the
-- conventions of 22_maintenance.sql (text+CHECK enums, partial indexes,
-- RLS, audit log).
--
-- Runtime SQL filter handles expiration — no cron required for correctness.
-- The cleanup cron is observability + storage hygiene only.
-- ---------------------------------------------------------------------------

create table public.global_notifications (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(title) between 1 and 200),
  body            text not null check (length(body) between 1 and 500),
  -- severity drives the banner color: info (teal) / warning (amber) / critical (red)
  severity        text not null default 'info'
                    check (severity in ('info', 'warning', 'critical')),
  active          boolean not null default true,
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  -- actor_id is text so the 'superadmin-secret' HMAC sentinel round-trips.
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Soft-archive columns. A DELETE in the API sets these instead of removing
  -- the row so audit history stays intact.
  archived_at     timestamptz,
  archived_by     text
);

-- Hot-path lookup: only currently-visible rows, ordered for the
-- priority-then-recency query used by the marquee endpoint.
-- The WHERE mirrors the runtime filter so the planner can use this index
-- for the active read.
create index global_notifications_active_idx
  on public.global_notifications (severity, created_at desc)
  where active = true;

-- Audit log for every CRUD write (create, update, archive). Reads are not
-- audited; the hot /active path is high-volume.
create table public.notifications_audit_log (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid references public.global_notifications(id) on delete set null,
  action          text not null check (action in (
                    'created', 'updated', 'archived'
                  )),
  actor_id        text,
  actor_type      text not null check (actor_type in ('superadmin', 'system')),
  previous_state  jsonb,
  new_state       jsonb,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index notifications_audit_log_created_idx
  on public.notifications_audit_log (created_at desc);
create index notifications_audit_log_notification_idx
  on public.notifications_audit_log (notification_id, created_at desc);

alter table public.global_notifications enable row level security;
alter table public.notifications_audit_log  enable row level security;

-- Superadmin read on both tables. No insert/update policies — the API uses
-- the service-role client, matching the maintenance pattern.
create policy global_notifications_superadmin_read on public.global_notifications
  for select using (public.is_superadmin());

create policy notifications_audit_log_superadmin_read on public.notifications_audit_log
  for select using (public.is_superadmin());
