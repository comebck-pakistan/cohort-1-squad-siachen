// Barrel re-exports for the maintenance module.

export {
  FALLBACK_MAINTENANCE_MESSAGE,
  type MaintenanceScope,
  type MaintenanceSource,
  type MaintenanceActorType,
  type MaintenanceAuditAction,
  type MaintenanceState,
  type MaintenanceWindowRow,
  type MaintenanceAuditRow,
  type EnforcementResult,
} from './types';

export {
  getEffectiveMaintenanceState,
  invalidateForSalon,
  type MaintenanceActorRole,
  type ResolverArgs,
} from './resolver';

export {
  enforceMaintenance,
  type EnforcementArgs,
} from './enforcement';

export {
  isInCooldown,
  recordCooldownSent,
  purgeStaleCooldowns,
} from './cooldown';

export {
  writeMaintenanceAudit,
  type MaintenanceAuditInput,
} from './audit';

export {
  cacheKey,
  getCached,
  setCached,
  invalidate,
  invalidateAll,
  size as cacheSize,
} from './cache';

export { default as router } from './routes';