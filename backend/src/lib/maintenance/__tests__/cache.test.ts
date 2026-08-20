// ---------------------------------------------------------------------------
// cache.test.ts — pure unit tests for the in-process TTL cache.
//
// No DB, no network. Verifies TTL expiry, key isolation, and invalidateAll.
// Run with `npx vitest run` once vitest is wired up in backend/package.json.
// ---------------------------------------------------------------------------

import {
  cacheKey,
  getCached,
  setCached,
  invalidate,
  invalidateAll,
  size,
} from '../cache';
import type { MaintenanceState } from '../types';

function makeState(): MaintenanceState {
  return {
    enabled: true,
    scope: 'global',
    bypassed: false,
    message: 'test message',
    cooldownMinutes: 30,
    startsAt: new Date('2026-08-19T00:00:00Z'),
    endsAt: new Date('2026-08-20T00:00:00Z'),
    windowId: 'win-123',
    inferred: false,
  };
}

describe('cache', () => {
  beforeEach(() => {
    invalidateAll();
  });

  it('cacheKey format is `scope:salonId`', () => {
    expect(cacheKey('global', null)).toBe('global:GLOBAL');
    expect(cacheKey('salon', 'abc-123')).toBe('salon:abc-123');
  });

  it('setCached + getCached round-trip', () => {
    const state = makeState();
    setCached('global:GLOBAL', state, 60_000);
    const got = getCached('global:GLOBAL');
    expect(got).toEqual(state);
    expect(size()).toBe(1);
  });

  it('returns null after TTL expires', () => {
    setCached('global:GLOBAL', makeState(), 100);
    const beforeExpiry = getCached('global:GLOBAL', Date.now() + 50);
    expect(beforeExpiry).not.toBeNull();
    const afterExpiry = getCached('global:GLOBAL', Date.now() + 200);
    expect(afterExpiry).toBeNull();
  });

  it('invalidate removes a single key', () => {
    setCached('global:GLOBAL', makeState());
    setCached('salon:abc', makeState());
    expect(size()).toBe(2);
    invalidate('global:GLOBAL');
    expect(size()).toBe(1);
    expect(getCached('global:GLOBAL')).toBeNull();
    expect(getCached('salon:abc')).not.toBeNull();
  });

  it('invalidateAll clears everything', () => {
    setCached('global:GLOBAL', makeState());
    setCached('salon:abc', makeState());
    setCached('salon:xyz', makeState());
    expect(size()).toBe(3);
    invalidateAll();
    expect(size()).toBe(0);
  });

  it('salon keys do not bleed into global or each other', () => {
    setCached('salon:abc', makeState());
    expect(getCached('salon:abc')).not.toBeNull();
    expect(getCached('salon:xyz')).toBeNull();
    expect(getCached('global:GLOBAL')).toBeNull();
  });
});