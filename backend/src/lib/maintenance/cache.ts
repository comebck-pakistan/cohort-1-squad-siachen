// ---------------------------------------------------------------------------
// In-process TTL cache for `MaintenanceState`.
//
// Used by `resolver.getEffectiveMaintenanceState` to avoid a DB hit on every
// inbound customer message (the maintenance check sits inside the hot path of
// `handleIncomingMessage`).
//
// MULTI-INSTANCE TRADEOFF (documented per the spec):
//   There is no cross-instance invalidation. If backend A processes an
//   admin toggle, backend B may continue to return stale-cached state for
//   up to TTL milliseconds. This is accepted because:
//
//     a) Admin toggles are interactive UI workflows — the operator waits
//        for the UI to confirm the toggle took effect.
//     b) A TTL window of extra "maintenance ON" is safer than premature
//        service resumption.
//     c) The 30-minute customer cooldown dominates the worst-case UX
//        impact: at worst a single extra maintenance reply per (salon,
//        customer) per TTL.
//
//   If a stricter contract is ever required, add `pg_notify` + per-instance
//   listener (out of scope for v1).
// ---------------------------------------------------------------------------

import type { MaintenanceState } from './types';

const DEFAULT_TTL_MS = Number(process.env.MAINTENANCE_CACHE_TTL_MS) || 30_000;

interface CacheEntry {
  state: MaintenanceState;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Cache key format: `scope:salonId` or `global:GLOBAL`. */
export function cacheKey(scope: 'global' | 'salon', salonId: string | null): string {
  return `${scope}:${salonId ?? 'GLOBAL'}`;
}

export function getCached(key: string, now: number = Date.now()): MaintenanceState | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.state;
}

export function setCached(
  key: string,
  state: MaintenanceState,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  cache.set(key, { state, expiresAt: Date.now() + ttlMs });
}

export function invalidate(key: string): void {
  cache.delete(key);
}

/** Clear every entry. Called by admin write paths and the cleanup cron. */
export function invalidateAll(): void {
  cache.clear();
}

/** Diagnostic helper — exposed for tests. */
export function size(): number {
  return cache.size;
}