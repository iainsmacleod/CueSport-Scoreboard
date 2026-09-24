/**
 * When cloud access ends (complimentary expiry or Stripe inactive) with no remaining
 * access grant, revoke Dock Keys and kick seats — without changing Stripe sync itself.
 */

import * as sqlite from '../db/sqlite.js';
import {
  hasCloudSubscriptionAccess,
  isAdminSupportTrialActive,
} from './subscription-access.js';

export const COMPLIMENTARY_EXPIRED_DOCK_MESSAGE =
  'Your complimentary CueSport Scoreboard Cloud access has ended. Subscribe in the dashboard to create new Dock Keys.';

export const SUBSCRIPTION_ENDED_DOCK_MESSAGE =
  'Your CueSport Scoreboard Cloud subscription has ended. Subscribe in the dashboard to create new Dock Keys.';

/**
 * If the account currently has no cloud access, revoke all Dock Keys and kick seats.
 * Safe no-op when complimentary or Stripe access is still valid.
 */
export async function revokeDockKeysIfNoCloudAccess(
  accountId,
  {
    message = SUBSCRIPTION_ENDED_DOCK_MESSAGE,
    nowMs = Date.now(),
  } = {},
) {
  if (!accountId) {
    return { revoked: false, keysRevoked: [], seatsKicked: 0 };
  }
  const account = sqlite.getAccountById(accountId);
  if (!account) {
    return { revoked: false, keysRevoked: [], seatsKicked: 0 };
  }
  if (hasCloudSubscriptionAccess(account, nowMs)) {
    return { revoked: false, keysRevoked: [], seatsKicked: 0 };
  }

  const keyIds = sqlite.revokeAllApiKeysForAccount(accountId);
  let seatsKicked = 0;
  if (keyIds.length) {
    const { revokeApiKeySeat } = await import('../ws/room-hub.js');
    for (const keyId of keyIds) {
      const { kicked } = revokeApiKeySeat(keyId, message);
      seatsKicked += kicked;
    }
  }
  return {
    revoked: keyIds.length > 0,
    keysRevoked: keyIds,
    seatsKicked,
  };
}

/**
 * If complimentary access has expired, clear trial_ends_at (and reset tier when inactive).
 * When no subscription access remains, revoke all Dock Keys and kick seats.
 *
 * @returns {null|{ cleared: true, keysRevoked: string[], seatsKicked: number, hadAccessAfterClear: boolean }}
 */
export async function enforceComplimentaryExpiryForAccount(accountId, nowMs = Date.now()) {
  if (!accountId) return null;
  const account = sqlite.getAccountById(accountId);
  if (!account?.trial_ends_at) return null;
  // Still within complimentary window — nothing to do.
  if (isAdminSupportTrialActive(account, nowMs)) return null;

  const updated = sqlite.clearAccountComplimentaryAccess(accountId);
  if (!updated) return null;

  const hadAccessAfterClear = hasCloudSubscriptionAccess(updated, nowMs);
  let keysRevoked = [];
  let seatsKicked = 0;

  if (!hadAccessAfterClear) {
    const result = await revokeDockKeysIfNoCloudAccess(accountId, {
      message: COMPLIMENTARY_EXPIRED_DOCK_MESSAGE,
      nowMs,
    });
    keysRevoked = result.keysRevoked;
    seatsKicked = result.seatsKicked;
  }

  return {
    cleared: true,
    keysRevoked,
    seatsKicked,
    hadAccessAfterClear,
  };
}

/** Sweep all accounts with a complimentary end date; enforce expiry where due. */
export async function sweepExpiredComplimentaryAccess(nowMs = Date.now()) {
  const rows = sqlite.listAccountsWithComplimentaryEndSet();
  const results = [];
  for (const row of rows) {
    try {
      const result = await enforceComplimentaryExpiryForAccount(row.id, nowMs);
      if (result) results.push({ accountId: row.id, ...result });
    } catch (err) {
      console.error('Complimentary expiry enforce error:', row.id, err);
    }
  }
  return results;
}

let complimentaryExpiryTimer = null;

export function startComplimentaryExpirySweeper(intervalMs = 5 * 60 * 1000) {
  if (complimentaryExpiryTimer) return;
  const tick = () => {
    sweepExpiredComplimentaryAccess().catch((err) => {
      console.error('Complimentary expiry sweeper error:', err);
    });
  };
  complimentaryExpiryTimer = setInterval(tick, Math.max(30_000, intervalMs));
  if (typeof complimentaryExpiryTimer.unref === 'function') {
    complimentaryExpiryTimer.unref();
  }
  // Run once shortly after boot so recently expired grants are cleaned without waiting.
  setTimeout(tick, 5_000).unref?.();
}
