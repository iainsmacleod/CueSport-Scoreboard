/**
 * When cloud access ends (complimentary expiry or Stripe inactive) with no remaining
 * access grant, revoke Dock Keys, close ad-hoc tables, and kick seats — without
 * changing Stripe sync itself.
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
 * If the account currently has no cloud access, revoke all Dock Keys, close ad-hoc
 * tables, and kick seats. Safe no-op when complimentary or Stripe access is still valid.
 */
export async function revokeDockKeysIfNoCloudAccess(
  accountId,
  {
    message = SUBSCRIPTION_ENDED_DOCK_MESSAGE,
    nowMs = Date.now(),
  } = {},
) {
  if (!accountId) {
    return {
      revoked: false,
      keysRevoked: [],
      seatsKicked: 0,
      adhocDeleted: 0,
      adhocKicked: 0,
      matchesDiscarded: 0,
    };
  }
  const account = sqlite.getAccountById(accountId);
  if (!account) {
    return {
      revoked: false,
      keysRevoked: [],
      seatsKicked: 0,
      adhocDeleted: 0,
      adhocKicked: 0,
      matchesDiscarded: 0,
    };
  }
  if (hasCloudSubscriptionAccess(account, nowMs)) {
    return {
      revoked: false,
      keysRevoked: [],
      seatsKicked: 0,
      adhocDeleted: 0,
      adhocKicked: 0,
      matchesDiscarded: 0,
    };
  }

  const {
    revokeApiKeySeat,
    deleteAccountAdhocSeats,
    ACCESS_ENDED_ADHOC_MESSAGE,
  } = await import('../ws/room-hub.js');

  const keyIds = sqlite.revokeAllApiKeysForAccount(accountId);
  let seatsKicked = 0;
  let matchesDiscarded = 0;
  if (keyIds.length) {
    for (const keyId of keyIds) {
      const { kicked, matchesDiscarded: discarded } = revokeApiKeySeat(keyId, message);
      seatsKicked += kicked;
      matchesDiscarded += Number(discarded) || 0;
    }
  }

  const adhoc = deleteAccountAdhocSeats(accountId, {
    code: 'access_ended',
    message: ACCESS_ENDED_ADHOC_MESSAGE,
  });
  matchesDiscarded += Number(adhoc.matchesDiscarded) || 0;

  return {
    revoked: keyIds.length > 0 || adhoc.adhocDeleted > 0,
    keysRevoked: keyIds,
    seatsKicked,
    adhocDeleted: adhoc.adhocDeleted,
    adhocKicked: adhoc.adhocKicked,
    matchesDiscarded,
  };
}

/**
 * If complimentary access has expired, clear trial_ends_at (and reset tier when inactive).
 * When no subscription access remains, revoke all Dock Keys, close ad-hoc tables, and kick seats.
 *
 * @returns {null|{ cleared: true, keysRevoked: string[], seatsKicked: number, adhocDeleted: number, adhocKicked: number, matchesDiscarded: number, hadAccessAfterClear: boolean }}
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
  let adhocDeleted = 0;
  let adhocKicked = 0;
  let matchesDiscarded = 0;

  if (!hadAccessAfterClear) {
    const result = await revokeDockKeysIfNoCloudAccess(accountId, {
      message: COMPLIMENTARY_EXPIRED_DOCK_MESSAGE,
      nowMs,
    });
    keysRevoked = result.keysRevoked;
    seatsKicked = result.seatsKicked;
    adhocDeleted = result.adhocDeleted;
    adhocKicked = result.adhocKicked;
    matchesDiscarded = result.matchesDiscarded;
  }

  return {
    cleared: true,
    keysRevoked,
    seatsKicked,
    adhocDeleted,
    adhocKicked,
    matchesDiscarded,
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
