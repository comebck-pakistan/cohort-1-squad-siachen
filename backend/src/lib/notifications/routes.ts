// ---------------------------------------------------------------------------
// Wave 20 — Global Notification API endpoints.
//
// Auth surface:
//   GET  /api/notifications/active  — any logged-in user (tenant or superadmin)
//   GET  /api/notifications         — [requireAuth, requireSuperadmin]
//   POST /api/notifications         — [requireAuth, requireSuperadmin]
//   PATCH /api/notifications/:id    — [requireAuth, requireSuperadmin]
//   DELETE /api/notifications/:id   — [requireAuth, requireSuperadmin]  (soft-archive)
//
// Caching: 30s TTL for the /active read (env NOTIFICATIONS_CACHE_TTL_MS).
// Cache invalidated on every write. Multi-instance divergence ≤ TTL is
// accepted (matches the maintenance pattern).
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../supabase';
import { requireAuth } from '../auth';
import { childLogger } from '../logger';
import type {
  NotificationAuditAction,
  NotificationInput,
  NotificationPatch,
  NotificationRow,
  NotificationSeverity,
} from './types';

const router = Router();
const log = childLogger('notifications.routes');

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DEFAULT_TTL_MS = 30_000;
const TTL_MS = (() => {
  const raw = process.env.NOTIFICATIONS_CACHE_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return DEFAULT_TTL_MS;
  return n;
})();

interface CacheEntry {
  value: NotificationRow | null;
  expiresAt: number;
}
const activeCache = new Map<string, CacheEntry>();
let activeCacheExpiresAt = 0;

function invalidateCache() {
  activeCache.clear();
  activeCacheExpiresAt = 0;
}

function actorPrincipal(req: Request): string {
  return req.user?.id ?? 'system';
}

const requireSuperadmin: import('express').RequestHandler = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.isSuperadmin) return next();
  const supabase = getSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  return next();
};

const authSuper = [requireAuth, requireSuperadmin];

// ─── Validators ─────────────────────────────────────────────────────────────

function validateTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length < 1 || t.length > 200) return null;
  return t;
}

function validateBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length < 1 || t.length > 500) return null;
  return t;
}

const VALID_SEVERITIES: NotificationSeverity[] = ['info', 'warning', 'critical'];

function validateSeverity(raw: unknown): NotificationSeverity | null {
  if (typeof raw !== 'string') return null;
  return (VALID_SEVERITIES as string[]).includes(raw)
    ? (raw as NotificationSeverity)
    : null;
}

function validateIsoInFuture(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;     // not provided
  if (raw === null || raw === '') return null; // explicit clear
  if (typeof raw !== 'string') return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

// ─── Audit writer (fire-and-forget) ─────────────────────────────────────────

async function writeAudit(input: {
  notificationId: string;
  action: NotificationAuditAction;
  actorId: string;
  actorType: 'superadmin' | 'system';
  previousState: NotificationRow | null;
  newState: NotificationRow | null;
  reason?: string | null;
}): Promise<void> {
  try {
    const { error } = await getSupabase().from('notifications_audit_log').insert({
      notification_id: input.notificationId,
      action: input.action,
      actor_id: input.actorId,
      actor_type: input.actorType,
      previous_state: input.previousState ?? null,
      new_state: input.newState ?? null,
      reason: input.reason ?? null,
      metadata: {},
    });
    if (error) {
      log.warn(
        { err: error.message, action: input.action, id: input.notificationId },
        'notifications audit write failed (non-fatal)',
      );
    }
  } catch (e) {
    log.warn(
      { err: (e as Error).message, action: input.action, id: input.notificationId },
      'notifications audit threw (non-fatal)',
    );
  }
}

// ─── Hot path: GET /active (any logged-in user) ─────────────────────────────

router.get('/active', requireAuth, async (_req: Request, res: Response) => {
  const now = Date.now();
  if (now < activeCacheExpiresAt && activeCache.has('singleton')) {
    const entry = activeCache.get('singleton')!;
    return res.json({ notification: entry.value });
  }
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('global_notifications')
      .select('id, title, body, severity, active, starts_at, ends_at, created_by, created_at, updated_at, archived_at, archived_by')
      .eq('active', true)
      .lte('starts_at', new Date().toISOString())
      .or('ends_at.is.null,ends_at.gt.' + new Date().toISOString())
      .order('severity', { ascending: true })   // critical < warning < info alphabetically
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      log.warn({ err: error.message }, 'notifications.active read failed');
      return res.json({ notification: null });
    }
    activeCache.set('singleton', {
      value: (data as NotificationRow | null) ?? null,
      expiresAt: now + TTL_MS,
    });
    activeCacheExpiresAt = now + TTL_MS;
    return res.json({ notification: data ?? null });
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'notifications.active threw');
    return res.json({ notification: null });
  }
});

// ─── Admin: list ────────────────────────────────────────────────────────────

router.get('/', authSuper, async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('global_notifications')
      .select('id, title, body, severity, active, starts_at, ends_at, created_by, created_at, updated_at, archived_at, archived_by')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      log.warn({ err: error.message }, 'notifications.list failed');
      return res.status(500).json({ code: 'INTERNAL', message: error.message });
    }
    return res.json({ notifications: (data ?? []) as NotificationRow[] });
  } catch (e) {
    return res.status(500).json({ code: 'INTERNAL', message: (e as Error).message });
  }
});

// ─── Admin: create ──────────────────────────────────────────────────────────

router.post('/', authSuper, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as NotificationInput;
  const title = validateTitle(body.title);
  if (!title) {
    return res.status(400).json({ code: 'VALIDATION', message: 'title required (1-200 chars)' });
  }
  const bodyText = validateBody(body.body);
  if (!bodyText) {
    return res.status(400).json({ code: 'VALIDATION', message: 'body required (1-500 chars)' });
  }
  const severity = validateSeverity(body.severity) ?? 'info';
  const startsAt = validateIsoInFuture(body.startsAt) ?? new Date().toISOString();
  const endsAt = validateIsoInFuture(body.endsAt) ?? null;
  if (body.endsAt && !endsAt) {
    return res.status(400).json({ code: 'VALIDATION', message: 'endsAt invalid' });
  }
  if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
    return res.status(400).json({ code: 'VALIDATION', message: 'endsAt must be in the future' });
  }
  const actor = actorPrincipal(req);
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('global_notifications')
      .insert({
        title,
        body: bodyText,
        severity,
        active: true,
        starts_at: startsAt,
        ends_at: endsAt,
        created_by: actor,
        updated_at: now,
      })
      .select('id, title, body, severity, active, starts_at, ends_at, created_by, created_at, updated_at, archived_at, archived_by')
      .single();
    if (error || !data) {
      return res.status(500).json({ code: 'INTERNAL', message: error?.message ?? 'insert failed' });
    }
    const row = data as NotificationRow;
    invalidateCache();
    log.info({ id: row.id, severity, actor }, 'notifications.created');
    void writeAudit({
      notificationId: row.id,
      action: 'created',
      actorId: actor,
      actorType: 'superadmin',
      previousState: null,
      newState: row,
    });
    return res.status(201).json({ notification: row });
  } catch (e) {
    return res.status(500).json({ code: 'INTERNAL', message: (e as Error).message });
  }
});

// ─── Admin: update (partial) ────────────────────────────────────────────────

router.patch('/:id', authSuper, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ code: 'VALIDATION', message: 'id must be a uuid' });
  }
  const patch = (req.body ?? {}) as NotificationPatch;
  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = validateTitle(patch.title);
    if (!t) return res.status(400).json({ code: 'VALIDATION', message: 'title invalid' });
    updates.title = t;
  }
  if (patch.body !== undefined) {
    const b = validateBody(patch.body);
    if (!b) return res.status(400).json({ code: 'VALIDATION', message: 'body invalid' });
    updates.body = b;
  }
  if (patch.severity !== undefined) {
    const s = validateSeverity(patch.severity);
    if (!s) return res.status(400).json({ code: 'VALIDATION', message: 'severity invalid' });
    updates.severity = s;
  }
  if (patch.startsAt !== undefined) {
    const sa = validateIsoInFuture(patch.startsAt);
    if (sa === undefined) {
      return res.status(400).json({ code: 'VALIDATION', message: 'startsAt invalid' });
    }
    if (sa !== null) updates.starts_at = sa;
  }
  if (patch.endsAt !== undefined) {
    const ea = validateIsoInFuture(patch.endsAt);
    if (ea === undefined) {
      return res.status(400).json({ code: 'VALIDATION', message: 'endsAt invalid' });
    }
    updates.ends_at = ea;          // null is valid → clear the expiry
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ code: 'VALIDATION', message: 'no fields to update' });
  }
  updates.updated_at = new Date().toISOString();

  try {
    const supabase = getSupabase();
    const { data: prev, error: prevErr } = await supabase
      .from('global_notifications')
      .select('id, title, body, severity, active, starts_at, ends_at, created_by, created_at, updated_at, archived_at, archived_by')
      .eq('id', id)
      .maybeSingle();
    if (prevErr) {
      return res.status(500).json({ code: 'INTERNAL', message: prevErr.message });
    }
    if (!prev) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'notification not found' });
    }
    const { data, error } = await supabase
      .from('global_notifications')
      .update(updates)
      .eq('id', id)
      .select('id, title, body, severity, active, starts_at, ends_at, created_by, created_at, updated_at, archived_at, archived_by')
      .single();
    if (error || !data) {
      return res.status(500).json({ code: 'INTERNAL', message: error?.message ?? 'update failed' });
    }
    const row = data as NotificationRow;
    invalidateCache();
    const actor = actorPrincipal(req);
    log.info({ id, actor, fields: Object.keys(updates) }, 'notifications.updated');
    void writeAudit({
      notificationId: id,
      action: 'updated',
      actorId: actor,
      actorType: 'superadmin',
      previousState: prev as NotificationRow,
      newState: row,
    });
    return res.json({ notification: row });
  } catch (e) {
    return res.status(500).json({ code: 'INTERNAL', message: (e as Error).message });
  }
});

// ─── Admin: soft-archive ────────────────────────────────────────────────────

router.delete('/:id', authSuper, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ code: 'VALIDATION', message: 'id must be a uuid' });
  }
  const actor = actorPrincipal(req);
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { data: prev, error: prevErr } = await supabase
      .from('global_notifications')
      .select('id, title, body, severity, active, starts_at, ends_at, created_by, created_at, updated_at, archived_at, archived_by')
      .eq('id', id)
      .maybeSingle();
    if (prevErr) {
      return res.status(500).json({ code: 'INTERNAL', message: prevErr.message });
    }
    if (!prev) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'notification not found' });
    }
    const { data, error } = await supabase
      .from('global_notifications')
      .update({
        active: false,
        archived_at: now,
        archived_by: actor,
        updated_at: now,
      })
      .eq('id', id)
      .select('id, title, body, severity, active, starts_at, ends_at, created_by, created_at, updated_at, archived_at, archived_by')
      .single();
    if (error || !data) {
      return res.status(500).json({ code: 'INTERNAL', message: error?.message ?? 'archive failed' });
    }
    const row = data as NotificationRow;
    invalidateCache();
    log.info({ id, actor }, 'notifications.archived');
    void writeAudit({
      notificationId: id,
      action: 'archived',
      actorId: actor,
      actorType: 'superadmin',
      previousState: prev as NotificationRow,
      newState: row,
    });
    return res.json({ notification: row });
  } catch (e) {
    return res.status(500).json({ code: 'INTERNAL', message: (e as Error).message });
  }
});

export { router as notificationsRouter, invalidateCache as invalidateNotificationsCache };
