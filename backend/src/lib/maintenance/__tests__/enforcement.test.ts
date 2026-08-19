// ---------------------------------------------------------------------------
// enforcement.test.ts — documents the expected behavior of enforceMaintenance.
//
// All tests here are DB-bound (resolver + cooldown) and skipped until
// vitest + Supabase mocking is wired into the backend. See the manual
// matrix in /home/vara/.claude/plans/cheerful-plotting-hamster.md for
// end-to-end verification.
// ---------------------------------------------------------------------------

import { enforceMaintenance } from '../enforcement';
import { invalidateAll } from '../cache';
import { FALLBACK_MAINTENANCE_MESSAGE } from '../types';

describe('enforceMaintenance', () => {
  beforeEach(() => invalidateAll());

  it.skip('maintenance off → blocked=false, no audit, no log', async () => {
    // mock: resolver returns disabled state
    const result = await enforceMaintenance({
      salonId: 'salon-1',
      from: '923001234567',
    });
    expect(result.blocked).toBe(false);
    expect(result.reply).toBeNull();
    expect(result.suppressedByCooldown).toBe(false);
  });

  it.skip('maintenance on, first call → blocked=true + reply + record cooldown', async () => {
    // mock: resolver returns enabled state with cooldown=30, cooldown table empty
    const result = await enforceMaintenance({
      salonId: 'salon-1',
      from: '923001234567',
    });
    expect(result.blocked).toBe(true);
    expect(result.suppressedByCooldown).toBe(false);
    expect(result.reply).toBeTruthy();
  });

  it.skip('maintenance on, second call within cooldown → blocked=true, reply=null, suppressed', async () => {
    // mock: cooldown table has a row for (salon-1, 923001234567) < 30 min old
    const result = await enforceMaintenance({
      salonId: 'salon-1',
      from: '923001234567',
    });
    expect(result.blocked).toBe(true);
    expect(result.suppressedByCooldown).toBe(true);
    expect(result.reply).toBeNull();
  });

  it.skip('resolver throws → fail-closed fallback reply', async () => {
    // mock: resolver throws
    const result = await enforceMaintenance({
      salonId: 'salon-1',
      from: '923001234567',
    });
    expect(result.blocked).toBe(true);
    expect(result.reply).toBe(FALLBACK_MAINTENANCE_MESSAGE);
    expect(result.state.inferred).toBe(true);
  });
});