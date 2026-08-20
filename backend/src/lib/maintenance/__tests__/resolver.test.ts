// ---------------------------------------------------------------------------
// resolver.test.ts — documents expected behavior of getEffectiveMaintenanceState.
//
// The function queries Supabase, which makes every test here DB-bound.
// Without a vitest + Supabase mock setup wired into the backend today,
// the actual cases are skipped and verified via the manual matrix in
// /home/vara/.claude/plans/cheerful-plotting-hamster.md instead.
//
// To run these:
//   1. Add vitest + @vitest/runner to backend/devDependencies
//   2. Mock getSupabase() via vi.mock('../supabase', ...)
//   3. Each test seeds a fake "windows" response and asserts the
//      resolved state shape.
// ---------------------------------------------------------------------------

import {
  getEffectiveMaintenanceState,
  type MaintenanceActorRole,
} from '../resolver';
import { invalidateAll } from '../cache';
import { FALLBACK_MAINTENANCE_MESSAGE } from '../types';

describe('getEffectiveMaintenanceState', () => {
  beforeEach(() => invalidateAll());

  it.skip('no rows → disabled state', async () => {
    const state = await getEffectiveMaintenanceState({
      salonId: 'salon-1',
      actorRole: 'system' as MaintenanceActorRole,
      now: new Date('2026-08-19T12:00:00Z'),
    });
    expect(state.enabled).toBe(false);
    expect(state.windowId).toBeNull();
  });

  it.skip('global row only → state from global', async () => {
    // mock getSupabase().from('maintenance_windows').select(...) → { data: { ...global row... }, error: null }
    const state = await getEffectiveMaintenanceState({
      salonId: 'salon-1',
      actorRole: 'system',
    });
    expect(state.enabled).toBe(true);
    expect(state.scope).toBe('global');
    expect(state.windowId).toBe('global-window-id');
  });

  it.skip('salon row wins over global row', async () => {
    // mock: global query returns one row, salon query returns a different
    // (more recent) row → result should be the salon row's windowId.
    const state = await getEffectiveMaintenanceState({
      salonId: 'salon-1',
      actorRole: 'system',
    });
    expect(state.scope).toBe('salon');
    expect(state.windowId).toBe('salon-window-id');
  });

  it.skip('ends_at <= now → treated as disabled even if enabled=true', async () => {
    // mock: row with ends_at='2026-08-19T11:00:00Z', now='2026-08-19T12:00:00Z'
    // the SQL `ends_at IS NULL OR ends_at > now` filters this row out.
    const state = await getEffectiveMaintenanceState({
      salonId: 'salon-1',
      actorRole: 'system',
      now: new Date('2026-08-19T12:00:00Z'),
    });
    expect(state.enabled).toBe(false);
  });

  it.skip('starts_at > now → scheduled, not yet active', async () => {
    // mock: row with starts_at='2026-08-19T13:00:00Z', now='2026-08-19T12:00:00Z'
    // the SQL `lte('starts_at', nowIso)` filters this row out.
    const state = await getEffectiveMaintenanceState({
      salonId: 'salon-1',
      actorRole: 'system',
      now: new Date('2026-08-19T12:00:00Z'),
    });
    expect(state.enabled).toBe(false);
  });

  it.skip('actorRole=superadmin → bypassed state regardless of windows', async () => {
    const state = await getEffectiveMaintenanceState({
      salonId: 'salon-1',
      actorRole: 'superadmin',
    });
    expect(state.enabled).toBe(false);
    expect(state.bypassed).toBe(true);
  });

  it.skip('actorRole=business_owner → NOT bypassed', async () => {
    // No rows + business_owner role → disabled, not bypassed.
    const state = await getEffectiveMaintenanceState({
      salonId: 'salon-1',
      actorRole: 'business_owner',
    });
    expect(state.enabled).toBe(false);
    expect(state.bypassed).toBe(false);
  });

  it.skip('DB exception → fail-closed inferred state', async () => {
    // mock: getSupabase().from(...) throws or returns { error: { message: '...' } }
    const state = await getEffectiveMaintenanceState({
      salonId: 'salon-1',
      actorRole: 'system',
    });
    expect(state.enabled).toBe(true);
    expect(state.inferred).toBe(true);
    expect(state.message).toBe(FALLBACK_MAINTENANCE_MESSAGE);
    expect(state.windowId).toBeNull();
  });
});