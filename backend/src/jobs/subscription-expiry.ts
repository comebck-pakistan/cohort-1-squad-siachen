// ---------------------------------------------------------------------------
// Subscription-expiry scheduled job — Wave 13.
//
// Runs hourly. Single transition:
//   (a) Find businesses with subscription_status='active' AND
//       next_billing_date < now(). Flip to 'expired' AND lock the agent
//       (agent_active=false) so the bot's short-circuit kicks in on the
//       next customer message.
//
// Idempotency: only fires when subscription_status='active' AND
// next_billing_date < now(). Already-expired rows are skipped.
//
// Note: we do NOT tear down the bridge session here. The bot stays alive
// but message-handler.ts must check both `agent_active` AND
// `subscription_status` and short-circuit on either. See the plan in
// task #444 and the existing trial-expiry pattern in jobs/trial-expiry.ts.
// ---------------------------------------------------------------------------

import { registerJob } from '../lib/scheduler';
import { expireOverdueSubscriptions } from '../lib/payments';
import { childLogger } from '../lib/logger';

const log = childLogger('job.subscription-expiry');

export function startSubscriptionExpiryJob(): void {
  registerJob(
    'subscription-expiry',
    runOnce,
    60 * 60 * 1000, // every hour
  );
  log.info('subscription-expiry job registered (hourly)');
}

export async function runOnce(): Promise<void> {
  try {
    await expireOverdueSubscriptions();
  } catch (e) {
    log.error(
      { err: (e as Error).message },
      'subscription-expiry: runOnce threw (will retry next tick)'
    );
  }
}
