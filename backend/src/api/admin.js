import * as sqlite from '../db/sqlite.js';
import { resolveAuthFromRequest } from './accounts.js';
import { isAccountAdminAuth } from '../lib/dock-roles.js';
import { isPlatformAdmin } from '../lib/platform-admin.js';
import { getAccountQuota, getPaidSelfServeTier, normalizeTierName } from '../quotas.js';
import { getAccountStats, getAllAccountsStats, namespaceAccountStats } from '../stats/account-stats.js';
import {
  kickAccountAdminClients,
  kickAccountClientsForDeletion,
  revokeApiKeySeat,
  roomHasConnectedDock,
  getRoomCleanupAfter,
  resolveRoomApiKeyId,
} from '../ws/room-hub.js';
import { hasCloudSubscriptionAccess } from '../lib/subscription-access.js';
import {
  cancelCustomerSubscriptions,
  customerHasPriorSubscription,
  listCancelableCustomerSubscriptions,
} from '../lib/stripe-billing.js';
import { deleteSupabaseAuthUser } from '../lib/supabase-admin.js';

const TRIAL_DAYS_MIN = 1;
const TRIAL_DAYS_MAX = 90;
const accountDeletionsInFlight = new Set();

async function requirePlatformAdmin(request, reply) {
  const auth = await resolveAuthFromRequest(request);
  if (!auth?.account) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!isAccountAdminAuth(auth)) {
    reply.code(403).send({ error: 'Account sign-in required' });
    return null;
  }
  if (!isPlatformAdmin(auth.account)) {
    reply.code(403).send({ error: 'Platform admin required' });
    return null;
  }
  return auth;
}

function trialEndsIsoFromDays(days) {
  const ms = Date.now() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

/** Block support mutations against the signed-in platform admin's own account. */
function rejectSelfAccountAdminMutation(auth, accountId, reply) {
  if (auth?.account?.id && accountId && auth.account.id === accountId) {
    reply.code(403).send({
      error: 'Cannot modify your own platform admin account from Admin. Use Settings instead.',
      code: 'admin_self_mutation_forbidden',
    });
    return true;
  }
  return false;
}

function enrichAdminRoom(room) {
  const cleanupMs = getRoomCleanupAfter(room.id);
  const apiKeyId = resolveRoomApiKeyId(room.id, room.api_key_id);
  const apiKey = apiKeyId ? sqlite.getApiKeyById(apiKeyId) : null;
  const apiKeyLabel = apiKey?.label || room.api_key_label || null;
  return {
    ...room,
    api_key_id: apiKeyId || null,
    api_key_label: apiKeyLabel,
    dock_label: apiKeyLabel || (room.dock_label !== 'Main table' && room.dock_label !== 'Default Room'
      ? room.dock_label
      : null) || apiKeyLabel || 'Connection',
    dock_connected: roomHasConnectedDock(room.id),
    cleanup_after: cleanupMs ? new Date(cleanupMs).toISOString() : null,
  };
}

export async function registerAdminRoutes(app) {
  app.get('/api/admin/accounts', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const q = typeof request.query.q === 'string' ? request.query.q : '';
    const limit = request.query.limit || '100';
    return { accounts: sqlite.listAccountsForAdmin({ q, limit }) };
  });

  app.get('/api/admin/accounts/:id', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const detail = sqlite.getAccountAdminDetail(request.params.id);
    if (!detail) return reply.code(404).send({ error: 'Account not found' });
    const account = sqlite.getAccountById(detail.id);
    return {
      account: detail,
      quota: account ? getAccountQuota(account) : null,
    };
  });

  app.post('/api/admin/account-blocks/unblock', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const email = sqlite.normalizeAccountEmail(request.body?.email);
    if (!email || !email.includes('@')) {
      return reply.code(400).send({ error: 'Enter the exact email address to unblock' });
    }
    if (!sqlite.fingerprintAccountEmail(email)) {
      return reply.code(503).send({ error: 'ACCOUNT_FINGERPRINT_SECRET is not configured' });
    }
    const unblocked = sqlite.unblockAccountEmail(email);
    return { ok: true, unblocked };
  });

  app.get('/api/admin/tables', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const limit = request.query.limit || '200';
    const accounts = sqlite.listAccountsForAdmin({ limit });
    const rooms = [];
    for (const account of accounts) {
      if (!account?.id) continue;
      for (const room of sqlite.getRoomsWithLiveState(account.id).map(enrichAdminRoom)) {
        rooms.push({
          ...room,
          account_id: account.id,
          account_email: account.email || account.id,
        });
      }
    }
    return { rooms, account_count: accounts.length };
  });

  app.get('/api/admin/stats', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const accountLimit = request.query.accountLimit || request.query.limit || '200';
    const limitPerAccount = request.query.limitPerAccount || '500';
    return getAllAccountsStats({
      accountLimit: Number(accountLimit) || 200,
      limitPerAccount: Number(limitPerAccount) || 500,
    });
  });

  app.get('/api/admin/players', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const q = typeof request.query.q === 'string' ? request.query.q : '';
    const max = Math.min(Math.max(parseInt(request.query.limit, 10) || 8, 1), 250);
    const accounts = sqlite.listAccountsForAdmin({ limit: 200 });
    const players = [];
    for (const account of accounts) {
      if (!account?.id || players.length >= max) break;
      const remaining = max - players.length;
      const rows = sqlite.searchAccountPlayers(account.id, q, remaining);
      for (const row of rows) {
        if (players.length >= max) break;
        const localId = String(row?.id || '').trim();
        if (!localId) continue;
        players.push({
          ...row,
          id: `${account.id}:${localId}`,
          localPlayerId: localId,
          accountId: account.id,
          accountEmail: account.email || account.id,
        });
      }
    }
    return { players, account_count: accounts.length };
  });

  app.get('/api/admin/accounts/:id/tables', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    return {
      account: { id: account.id, email: account.email },
      rooms: sqlite.getRoomsWithLiveState(account.id).map(enrichAdminRoom),
    };
  });

  app.get('/api/admin/accounts/:id/stats', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    const limit = request.query.limit || '5000';
    return namespaceAccountStats(getAccountStats(account.id, limit), account.id, account.email);
  });

  app.get('/api/admin/accounts/:id/players', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    const q = typeof request.query.q === 'string' ? request.query.q : '';
    const limit = request.query.limit || '8';
    return {
      players: sqlite.searchAccountPlayers(account.id, q, limit).map((row) => {
        const localId = String(row?.id || '').trim();
        if (!localId) return row;
        return {
          ...row,
          id: `${account.id}:${localId}`,
          localPlayerId: localId,
          accountId: account.id,
          accountEmail: account.email || account.id,
        };
      }),
    };
  });

  app.post('/api/admin/accounts/:id/trial', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    if (rejectSelfAccountAdminMutation(auth, account.id, reply)) return;
    const daysRaw = Number(request.body?.days);
    if (!Number.isFinite(daysRaw)) {
      return reply.code(400).send({ error: `days must be an integer from ${TRIAL_DAYS_MIN} to ${TRIAL_DAYS_MAX}` });
    }
    const days = Math.floor(daysRaw);
    if (days < TRIAL_DAYS_MIN || days > TRIAL_DAYS_MAX) {
      return reply.code(400).send({ error: `days must be an integer from ${TRIAL_DAYS_MIN} to ${TRIAL_DAYS_MAX}` });
    }
    const allowedTiers = new Set(getPaidSelfServeTier());
    const tierRaw = request.body?.tier != null
      ? String(request.body.tier).trim().toLowerCase()
      : 'streamer';
    if (!allowedTiers.has(tierRaw)) {
      return reply.code(400).send({
        error: 'tier must be streamer, tournament_organizer, or league_director',
      });
    }
    const tier = normalizeTierName(tierRaw);
    const trialEndsAt = trialEndsIsoFromDays(days);
    const updated = sqlite.setAccountComplimentaryAccess(account.id, {
      trialEndsAt,
      subscriptionTier: tier,
    });
    return {
      ok: true,
      trial_ends_at: updated.trial_ends_at,
      subscription_tier: updated.subscription_tier,
      account: sqlite.getAccountAdminDetail(account.id),
    };
  });

  app.delete('/api/admin/accounts/:id/trial', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    if (rejectSelfAccountAdminMutation(auth, account.id, reply)) return;
    const updated = sqlite.clearAccountComplimentaryAccess(account.id);
    let revokedKeyIds = [];
    let seatsKicked = 0;
    // No Stripe (or other) access left → revoke Dock Keys and disconnect seats.
    if (!hasCloudSubscriptionAccess(updated)) {
      revokedKeyIds = sqlite.revokeAllApiKeysForAccount(account.id);
      for (const keyId of revokedKeyIds) {
        const { kicked } = revokeApiKeySeat(keyId);
        seatsKicked += kicked;
      }
    }
    return {
      ok: true,
      trial_ends_at: null,
      keys_revoked: revokedKeyIds.length,
      seats_kicked: seatsKicked,
      account: sqlite.getAccountAdminDetail(account.id),
    };
  });

  app.post('/api/admin/accounts/:id/invalidate-sessions', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    if (rejectSelfAccountAdminMutation(auth, account.id, reply)) return;
    const updated = sqlite.invalidateAllSessions(account.id);
    const kicked = kickAccountAdminClients(account.id);
    return {
      ok: true,
      session_epoch: updated.session_epoch,
      sessions_invalid_after: updated.sessions_invalid_after,
      kicked,
    };
  });

  app.post('/api/admin/accounts/:id/delete', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    if (rejectSelfAccountAdminMutation(auth, account.id, reply)) return;

    const confirmedEmail = sqlite.normalizeAccountEmail(request.body?.confirmEmail);
    if (!confirmedEmail || confirmedEmail !== sqlite.normalizeAccountEmail(account.email)) {
      return reply.code(400).send({
        error: 'Type the account email exactly to confirm deletion',
        code: 'email_confirmation_required',
      });
    }
    if (!sqlite.fingerprintAccountEmail(account.email)) {
      return reply.code(503).send({
        error: 'ACCOUNT_FINGERPRINT_SECRET is not configured',
        code: 'fingerprint_secret_required',
      });
    }
    if (accountDeletionsInFlight.has(account.id)) {
      return reply.code(409).send({
        error: 'Account deletion is already in progress',
        code: 'deletion_in_progress',
      });
    }

    let subscriptions;
    try {
      subscriptions = await listCancelableCustomerSubscriptions(account.stripe_customer_id);
    } catch (error) {
      request.log.error({ err: error, accountId: account.id }, 'Stripe deletion preview failed');
      return reply.code(502).send({
        error: error?.message || 'Could not check Stripe subscriptions',
        code: 'stripe_preview_failed',
      });
    }
    if (subscriptions.length && request.body?.confirmActiveSubscription !== true) {
      return reply.code(409).send({
        error: 'This account has active Stripe billing. Confirm again to cancel billing and delete the account.',
        code: 'active_subscription_confirmation_required',
        subscriptions,
      });
    }

    accountDeletionsInFlight.add(account.id);
    try {
      sqlite.markAccountDeleting(account.id);
      const revokedKeyIds = sqlite.revokeAllApiKeysForAccount(account.id);
      const revokedGuestLinks = sqlite.revokeAllGuestTokens(account.id);
      const clientsKicked = kickAccountClientsForDeletion(account.id);

      const priorTrial = sqlite.hasEmailUsedTrial(account.email)
        || (account.stripe_customer_id
          ? await customerHasPriorSubscription(account.stripe_customer_id)
          : false);
      const stripeResult = account.stripe_customer_id
        ? await cancelCustomerSubscriptions(account.stripe_customer_id)
        : { canceled: 0, subscriptions: [] };
      await deleteSupabaseAuthUser(account.auth_user_id);
      sqlite.finalizeAccountDeletion(account.id, {
        blockFutureSignups: request.body?.blockFutureSignups === true,
        trialUsed: priorTrial,
        allowAnotherTrial: request.body?.allowAnotherTrial === true,
      });

      return {
        ok: true,
        account_id: account.id,
        subscriptions_canceled: stripeResult.canceled,
        keys_revoked: revokedKeyIds.length,
        guest_links_revoked: revokedGuestLinks,
        clients_kicked: clientsKicked,
        future_signups_blocked: request.body?.blockFutureSignups === true,
        trial_eligibility_reset: request.body?.allowAnotherTrial === true,
      };
    } catch (error) {
      request.log.error({ err: error, accountId: account.id }, 'Account deletion failed');
      sqlite.setAccountDeletionError(account.id, error?.message || 'Account deletion failed');
      return reply.code(502).send({
        error: 'Account deletion did not complete. The account remains locked; retry deletion after resolving the service error.',
        detail: error?.message || null,
        code: 'account_deletion_failed',
      });
    } finally {
      accountDeletionsInFlight.delete(account.id);
    }
  });

  app.post('/api/admin/accounts/:id/api-keys/:keyId/revoke', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const { id: accountId, keyId } = request.params;
    const account = sqlite.getAccountById(accountId);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    if (rejectSelfAccountAdminMutation(auth, account.id, reply)) return;
    const ok = sqlite.revokeApiKey(keyId, accountId);
    if (!ok) return reply.code(404).send({ error: 'API key not found' });
    const { kicked, roomDeleted } = revokeApiKeySeat(keyId);
    return {
      ok: true,
      kicked,
      room_deleted: roomDeleted,
      account: sqlite.getAccountAdminDetail(accountId),
    };
  });
}
