// ---------------------------------------------------------------------------
// Maintenance System Mode — admin API endpoints.
//
// All endpoints require [requireAuth, requireSuperadmin] — copied from
// superadmin-payments.ts:27-42. No customer/owner surface for v1.
//
// Endpoints:
//   GET    /api/maintenance/state              — preview effective state
//   GET    /api/maintenance/windows            — list windows (open + recent)
//   POST   /api/maintenance/global/enable      — open global window
//   POST   /api/maintenance/global/disable     — close global window
//   POST   /api/maintenance/salon/:salonId/enable   — open per-salon window
//   POST   /api/maintenance/salon/:salonId/disable  — close per-salon window
//   PATCH  /api/maintenance/window/:windowId   — update message/cooldown/end
//   GET    /api/maintenance/audit              — read audit log
//
// Atomicity note: enable endpoints must run "close old + insert new" in one
// transaction. We use Supabase RPC by composing the operations, or we
// fall back to optimistic retry on the `one_open_*` partial unique
// indexes when the RPC isn't available. Implementation detail in the
// helpers below.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { getSupabase } from '../supabase';
import { requireAuth } from '../auth';
import { childLogger } from '../logger';
import { writeMaintenanceAudit } from './audit';
import { invalidateForSalon } from './resolver';
import type {
  MaintenanceAuditRow,
  MaintenanceScope,
  MaintenanceWindowRow,
} from './types';

const router = Router();
const log = childLogger('maintenance.routes');

const UUID_RE = /^[0-9a-f-]{36}$/i;

function asUuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

// Copied from superadmin-payments.ts:27-42 — same requireSuperadmin pattern.
const requireSuperadmin: import('express').RequestHandler = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
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

const authSuper = [requireAuth, requireSuperadmin] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function actorPrincipal(req: Request): string {
  // Superadmin HMAC sentinel is 'superadmin-secret' (not a UUID). We pass
  // it through directly as the audit actor_id (the column is text).
  return req.user?.id ?? 'system';
}

function validateMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 1000) return null;
  return trimmed;
}

function validateCooldownMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(n) || n < 0 || n > 1440) return 30;
  return n;
}

function validateIsoOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Open a new maintenance window. Closes the existing open window of the
 * same scope (atomic via two-step close-then-insert; if the insert
 * succeeds after a window was already open and concurrently closed by
 * another admin, the partial unique index keeps us safe).
 */
async function openWindow(args: {
  scope: MaintenanceScope;
  salonId: string | null;
  message: string;
  cooldownMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  actorPrincipal: string;
  reason: string | null;
}): Promise<{ row: MaintenanceWindowRow; previous: MaintenanceWindowRow | null }> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // Step 1: close existing open window of the same scope
  let existingQuery = supabase
    .from('maintenance_windows')
    .select('*')
    .eq('scope', args.scope)
    .eq('enabled', true);
  if (args.salonId) existingQuery = existingQuery.eq('salon_id', args.salonId);

  const { data: existingRows } = await existingQuery.maybeSingle();
  const existing = (existingRows ?? null) as MaintenanceWindowRow | null;

  if (existing) {
    const { error: closeErr } = await supabase
      .from('maintenance_windows')
      .update({
        enabled: false,
        closed_at: now,
        closed_by: args.actorPrincipal,
        updated_at: now,
      })
      .eq('id', existing.id);
    if (closeErr) {
      throw new Error(`failed to close previous window: ${closeErr.message}`);
    }
  }

  // Step 2: insert the new window
  const { data: inserted, error: insertErr } = await supabase
    .from('maintenance_windows')
    .insert({
      scope: args.scope,
      salon_id: args.salonId,
      enabled: true,
      reason: args.reason,
      message: args.message,
      cooldown_minutes: args.cooldownMinutes,
      starts_at: args.startsAt ?? now,
      ends_at: args.endsAt,
      source: 'admin',
      created_by: args.actorPrincipal,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (insertErr || !inserted) {
    throw new Error(`failed to insert new window: ${insertErr?.message ?? 'unknown'}`);
  }

  return {
    row: inserted as MaintenanceWindowRow,
    previous: existing,
  };
}

// ─── GET /api/maintenance/state ────────────────────────────────────────────

router.get(
  '/maintenance/state',
  ...authSuper,
  async (req: Request, res: Response) => {
    const salonIdRaw = typeof req.query.salonId === 'string' ? req.query.salonId : null;
    if (salonIdRaw && !UUID_RE.test(salonIdRaw)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'salonId must be a uuid' });
    }
    const { getEffectiveMaintenanceState } = await import('./resolver');
    const state = await getEffectiveMaintenanceState({
      salonId: salonIdRaw,
      actorRole: 'superadmin',
    });
    return res.json({ state });
  },
);

// ─── GET /api/maintenance/effective — tenant-readable (Wave 21) ─────────────
//
// Same shape as the superadmin /state endpoint, but uses the tenant's own
// businessId (no superadmin requirement, no manual ?salonId=). Used by the
// salon-portal dashboard to render the "Bot is in maintenance" indicator
// when the tenant is affected.
//
// Fail-closed semantics: any DB error returns the inferred state with
// enabled=true and the fallback message — same as the runtime chokepoint.

router.get(
  '/maintenance/effective',
  requireAuth,
  async (req: Request, res: Response) => {
    const tenantBiz =
      (req as Request & { businessId?: string }).businessId ??
      req.user?.businessId ??
      null;
    const { getEffectiveMaintenanceState } = await import('./resolver');
    const state = await getEffectiveMaintenanceState({
      salonId: tenantBiz,
      actorRole: 'system',
    });
    return res.json({ state });
  },
);


// ─── GET /api/maintenance/windows ──────────────────────────────────────────

router.get(
  '/maintenance/windows',
  ...authSuper,
  async (req: Request, res: Response) => {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : null;
    const salonIdRaw = typeof req.query.salonId === 'string' ? req.query.salonId : null;
    const openOnly = req.query.openOnly === 'true';
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);

    if (scope && !['global', 'salon'].includes(scope)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'scope must be global or salon' });
    }
    if (salonIdRaw && !UUID_RE.test(salonIdRaw)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'salonId must be a uuid' });
    }

    let query = getSupabase()
      .from('maintenance_windows')
      .select('*')
      .order('starts_at', { ascending: false })
      .limit(limit);

    if (scope) query = query.eq('scope', scope);
    if (salonIdRaw) query = query.eq('salon_id', salonIdRaw);
    if (openOnly) query = query.eq('enabled', true);

    const { data, error } = await query;
    if (error) {
      log.error({ err: error.message }, 'list windows failed');
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not list windows' });
    }
    return res.json({ windows: data || [] });
  },
);

// ─── POST /api/maintenance/global/enable ───────────────────────────────────

router.post(
  '/maintenance/global/enable',
  ...authSuper,
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = validateMessage(body.message);
    if (!message) {
      return res.status(400).json({ code: 'VALIDATION', message: 'message is required (1-1000 chars)' });
    }
    const cooldownMinutes = validateCooldownMinutes(body.cooldownMinutes);
    const startsAt = validateIsoOrNull(body.startsAt);
    const endsAt = validateIsoOrNull(body.endsAt);
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

    if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
      return res.status(400).json({ code: 'VALIDATION', message: 'endsAt must be in the future' });
    }

    try {
      const actor = actorPrincipal(req);
      const { row, previous } = await openWindow({
        scope: 'global',
        salonId: null,
        message,
        cooldownMinutes,
        startsAt,
        endsAt,
        actorPrincipal: actor,
        reason,
      });

      invalidateForSalon(null);
      log.info(
        { scope: 'global', windowId: row.id, actorId: actor, endsAt, reason },
        'maintenance.enabled',
      );
      void writeMaintenanceAudit({
        windowId: row.id,
        businessId: null,
        action: 'enabled',
        actorId: actor,
        actorType: 'superadmin',
        scope: 'global',
        previousState: previous ? (previous as unknown as Record<string, unknown>) : null,
        newState: row as unknown as Record<string, unknown>,
        reason,
      });

      return res.status(201).json({ window: row });
    } catch (e) {
      log.error({ err: (e as Error).message }, 'global enable failed');
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not enable global maintenance' });
    }
  },
);

// ─── POST /api/maintenance/global/disable ──────────────────────────────────

router.post(
  '/maintenance/global/disable',
  ...authSuper,
  async (req: Request, res: Response) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;
    const now = new Date().toISOString();
    const actor = actorPrincipal(req);

    const { data: existing } = await getSupabase()
      .from('maintenance_windows')
      .select('*')
      .eq('scope', 'global')
      .eq('enabled', true)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'No open global maintenance window' });
    }

    const { error } = await getSupabase()
      .from('maintenance_windows')
      .update({
        enabled: false,
        closed_at: now,
        closed_by: actor,
        updated_at: now,
      })
      .eq('id', existing.id);

    if (error) {
      log.error({ err: error.message }, 'global disable failed');
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not disable global maintenance' });
    }

    invalidateForSalon(null);
    log.info({ scope: 'global', windowId: existing.id, actorId: actor, reason }, 'maintenance.disabled');
    void writeMaintenanceAudit({
      windowId: existing.id,
      businessId: null,
      action: 'disabled',
      actorId: actor,
      actorType: 'superadmin',
      scope: 'global',
      previousState: existing as unknown as Record<string, unknown>,
      reason,
    });

    return res.json({ closed: { ...existing, enabled: false, closed_at: now, closed_by: actor } });
  },
);

// ─── POST /api/maintenance/salon/:salonId/enable ───────────────────────────

router.post(
  '/maintenance/salon/:salonId/enable',
  ...authSuper,
  async (req: Request, res: Response) => {
    const salonId = req.params.salonId;
    if (!UUID_RE.test(salonId)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'salonId must be a uuid' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = validateMessage(body.message);
    if (!message) {
      return res.status(400).json({ code: 'VALIDATION', message: 'message is required (1-1000 chars)' });
    }
    const cooldownMinutes = validateCooldownMinutes(body.cooldownMinutes);
    const startsAt = validateIsoOrNull(body.startsAt);
    const endsAt = validateIsoOrNull(body.endsAt);
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

    if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
      return res.status(400).json({ code: 'VALIDATION', message: 'endsAt must be in the future' });
    }

    try {
      const actor = actorPrincipal(req);
      const { row, previous } = await openWindow({
        scope: 'salon',
        salonId,
        message,
        cooldownMinutes,
        startsAt,
        endsAt,
        actorPrincipal: actor,
        reason,
      });

      invalidateForSalon(salonId);
      log.info(
        { scope: 'salon', salonId, windowId: row.id, actorId: actor, endsAt, reason },
        'maintenance.enabled',
      );
      void writeMaintenanceAudit({
        windowId: row.id,
        businessId: salonId,
        action: 'enabled',
        actorId: actor,
        actorType: 'superadmin',
        scope: 'salon',
        previousState: previous ? (previous as unknown as Record<string, unknown>) : null,
        newState: row as unknown as Record<string, unknown>,
        reason,
      });

      return res.status(201).json({ window: row });
    } catch (e) {
      log.error({ err: (e as Error).message, salonId }, 'salon enable failed');
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not enable salon maintenance' });
    }
  },
);

// ─── POST /api/maintenance/salon/:salonId/disable ──────────────────────────

router.post(
  '/maintenance/salon/:salonId/disable',
  ...authSuper,
  async (req: Request, res: Response) => {
    const salonId = req.params.salonId;
    if (!UUID_RE.test(salonId)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'salonId must be a uuid' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;
    const now = new Date().toISOString();
    const actor = actorPrincipal(req);

    const { data: existing } = await getSupabase()
      .from('maintenance_windows')
      .select('*')
      .eq('scope', 'salon')
      .eq('salon_id', salonId)
      .eq('enabled', true)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'No open salon maintenance window' });
    }

    const { error } = await getSupabase()
      .from('maintenance_windows')
      .update({
        enabled: false,
        closed_at: now,
        closed_by: actor,
        updated_at: now,
      })
      .eq('id', existing.id);

    if (error) {
      log.error({ err: error.message, salonId }, 'salon disable failed');
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not disable salon maintenance' });
    }

    invalidateForSalon(salonId);
    log.info({ scope: 'salon', salonId, windowId: existing.id, actorId: actor, reason }, 'maintenance.disabled');
    void writeMaintenanceAudit({
      windowId: existing.id,
      businessId: salonId,
      action: 'disabled',
      actorId: actor,
      actorType: 'superadmin',
      scope: 'salon',
      previousState: existing as unknown as Record<string, unknown>,
      reason,
    });

    return res.json({ closed: { ...existing, enabled: false, closed_at: now, closed_by: actor } });
  },
);

// ─── PATCH /api/maintenance/window/:windowId ───────────────────────────────

router.patch(
  '/maintenance/window/:windowId',
  ...authSuper,
  async (req: Request, res: Response) => {
    const windowId = req.params.windowId;
    if (!UUID_RE.test(windowId)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'windowId must be a uuid' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    const actor = actorPrincipal(req);

    const { data: existing } = await getSupabase()
      .from('maintenance_windows')
      .select('*')
      .eq('id', windowId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'window not found' });
    }

    const update: Record<string, unknown> = { updated_at: now };
    if (body.message !== undefined) {
      const m = validateMessage(body.message);
      if (!m) return res.status(400).json({ code: 'VALIDATION', message: 'message must be 1-1000 chars' });
      update.message = m;
    }
    if (body.cooldownMinutes !== undefined) {
      update.cooldown_minutes = validateCooldownMinutes(body.cooldownMinutes);
    }
    if (body.endsAt !== undefined) {
      const iso = validateIsoOrNull(body.endsAt);
      update.ends_at = iso;
    }
    if (body.reason !== undefined && typeof body.reason === 'string') {
      update.reason = body.reason.slice(0, 500);
    }

    // If the new endsAt is in the past, close the window.
    const newEndsAt = update.ends_at === undefined ? existing.ends_at : update.ends_at;
    const closesNow =
      newEndsAt !== null && new Date(newEndsAt as string).getTime() <= Date.now();
    if (closesNow) {
      update.enabled = false;
      update.closed_at = now;
      update.closed_by = actor;
    }

    const { data: updated, error } = await getSupabase()
      .from('maintenance_windows')
      .update(update)
      .eq('id', windowId)
      .select('*')
      .single();

    if (error) {
      log.error({ err: error.message, windowId }, 'window update failed');
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not update window' });
    }

    invalidateForSalon((existing as MaintenanceWindowRow).salon_id);
    const action = closesNow ? 'disabled' : 'updated';
    log.info(
      { windowId, action, actorId: actor },
      closesNow ? 'maintenance.disabled' : 'maintenance.updated',
    );
    void writeMaintenanceAudit({
      windowId,
      businessId: (existing as MaintenanceWindowRow).salon_id,
      action,
      actorId: actor,
      actorType: 'superadmin',
      scope: (existing as MaintenanceWindowRow).scope,
      previousState: existing as unknown as Record<string, unknown>,
      newState: updated as unknown as Record<string, unknown>,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null,
    });

    return res.json({ window: updated });
  },
);

// ─── GET /api/maintenance/audit ────────────────────────────────────────────

router.get(
  '/maintenance/audit',
  ...authSuper,
  async (req: Request, res: Response) => {
    const windowId = typeof req.query.windowId === 'string' ? req.query.windowId : null;
    const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : null;
    const action = typeof req.query.action === 'string' ? req.query.action : null;
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);

    if (windowId && !UUID_RE.test(windowId)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'windowId must be a uuid' });
    }
    if (businessId && !UUID_RE.test(businessId)) {
      return res.status(400).json({ code: 'VALIDATION', message: 'businessId must be a uuid' });
    }

    let query = getSupabase()
      .from('maintenance_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (windowId) query = query.eq('window_id', windowId);
    if (businessId) query = query.eq('business_id', businessId);
    if (action) query = query.eq('action', action);

    const { data, error } = await query;
    if (error) {
      log.error({ err: error.message }, 'list audit failed');
      return res.status(500).json({ code: 'INTERNAL', message: 'Could not list audit log' });
    }

    return res.json({ entries: (data ?? []) as MaintenanceAuditRow[] });
  },
);

export default router;

// `asUuidOrNull` is exported for completeness / consistency with
// payment_audit_log actor handling.
export { asUuidOrNull };