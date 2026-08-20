// ---------------------------------------------------------------------------
// enforceMaintenance — composes resolver + cooldown into the single call
// the chokepoint in `message-handler.ts` uses.
//
// Behavior:
//   1. Resolve effective state for (salon, customer).
//   2. If disabled → return `{ blocked: false, ... }`. No audit, no log.
//   3. If enabled and customer is in cooldown → `blocked: true`,
//      `reply: null`, `suppressedByCooldown: true`. Fire-and-forget
//      `response_suppressed` audit.
//   4. If enabled and customer is NOT in cooldown → `blocked: true`,
//      `reply: <fixed message>`. Record cooldown. Fire-and-forget
//      `response_sent` audit.
//
// High-volume response_sent/response_suppressed writes are intentionally
// fire-and-forget. The structured log is the primary observability surface;
// the audit row is for the UI history.
// ---------------------------------------------------------------------------

import { getEffectiveMaintenanceState } from './resolver';
import {
  isInCooldown,
  recordCooldownSent,
} from './cooldown';
import { writeMaintenanceAudit } from './audit';
import { childLogger } from '../logger';
import type {
  EnforcementResult,
  MaintenanceActorType,
  MaintenanceState,
} from './types';
import type { MaintenanceActorRole } from './resolver';

const log = childLogger('maintenance.enforcement');

export interface EnforcementArgs {
  salonId: string;
  from: string;
  now?: Date;
  /**
   * Optional — defaults to 'system' (the inbound customer-message path).
   * Resolver treats superadmin as bypassed; the customer path always
   * passes 'system'.
   */
  actorRole?: MaintenanceActorRole;
}

export async function enforceMaintenance(
  args: EnforcementArgs,
): Promise<EnforcementResult> {
  const now = args.now ?? new Date();

  let state: MaintenanceState;
  try {
    state = await getEffectiveMaintenanceState({
      salonId: args.salonId,
      actorRole: args.actorRole ?? 'system',
      now,
    });
  } catch (e) {
    // Resolver already handles its own errors with fail-closed inferred
    // state. If something still throws here, treat it as fail-closed too.
    log.warn(
      {
        err: (e as Error).message,
        salonId: args.salonId,
      },
      'enforceMaintenance resolver threw — fail-closed',
    );
    state = {
      enabled: true,
      scope: 'global',
      bypassed: false,
      message:
        "We're temporarily down for maintenance and will be back shortly.",
      cooldownMinutes: 30,
      startsAt: null,
      endsAt: null,
      windowId: null,
      inferred: true,
    };
  }

  if (!state.enabled) {
    return {
      blocked: false,
      reply: null,
      state,
      suppressedByCooldown: false,
    };
  }

  // Maintenance is on. Check the per-(salon, customer) cooldown.
  const inCooldown = await isInCooldown(
    args.salonId,
    args.from,
    now,
    state.cooldownMinutes,
  );

  if (inCooldown) {
    log.info(
      {
        salonId: args.salonId,
        customerPhone: args.from,
        windowId: state.windowId,
      },
      'maintenance_response_suppressed',
    );
    // Fire-and-forget audit
    void writeMaintenanceAudit({
      windowId: state.windowId,
      businessId: args.salonId,
      action: 'response_suppressed',
      actorId: null,
      actorType: 'system',
      scope: state.scope,
    });
    return {
      blocked: true,
      reply: null,
      state,
      suppressedByCooldown: true,
    };
  }

  // First message from this customer within the cooldown window — record
  // the cooldown and surface the fixed reply.
  void recordCooldownSent(args.salonId, args.from, state.windowId, now);
  log.info(
    {
      salonId: args.salonId,
      customerPhone: args.from,
      windowId: state.windowId,
      cooldownMinutes: state.cooldownMinutes,
    },
    'maintenance_response_sent',
  );
  void writeMaintenanceAudit({
    windowId: state.windowId,
    businessId: args.salonId,
    action: 'response_sent',
    actorId: null,
    actorType: 'system',
    scope: state.scope,
  });

  return {
    blocked: true,
    reply: state.message,
    state,
    suppressedByCooldown: false,
  };
}