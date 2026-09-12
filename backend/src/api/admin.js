import * as sqlite from '../db/sqlite.js';
import { resolveAuthFromRequest } from './accounts.js';
import { isAccountAdminAuth } from '../lib/dock-roles.js';
import { isPlatformAdmin } from '../lib/platform-admin.js';
import { getAccountQuota } from '../quotas.js';
import { getAccountStats } from '../stats/account-stats.js';
import {
  kickAccountAdminClients,
  kickApiKeyDocks,
} from '../ws/room-hub.js';

const TRIAL_DAYS_MIN = 1;
const TRIAL_DAYS_MAX = 90;

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

  app.get('/api/admin/accounts/:id/stats', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    const limit = request.query.limit || '5000';
    return getAccountStats(account.id, limit);
  });

  app.post('/api/admin/accounts/:id/trial', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    const daysRaw = Number(request.body?.days);
    if (!Number.isFinite(daysRaw)) {
      return reply.code(400).send({ error: `days must be an integer from ${TRIAL_DAYS_MIN} to ${TRIAL_DAYS_MAX}` });
    }
    const days = Math.floor(daysRaw);
    if (days < TRIAL_DAYS_MIN || days > TRIAL_DAYS_MAX) {
      return reply.code(400).send({ error: `days must be an integer from ${TRIAL_DAYS_MIN} to ${TRIAL_DAYS_MAX}` });
    }
    const trialEndsAt = trialEndsIsoFromDays(days);
    const updated = sqlite.setAccountTrialEndsAt(account.id, trialEndsAt);
    return {
      ok: true,
      trial_ends_at: updated.trial_ends_at,
      account: sqlite.getAccountAdminDetail(account.id),
    };
  });

  app.delete('/api/admin/accounts/:id/trial', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    sqlite.setAccountTrialEndsAt(account.id, null);
    return {
      ok: true,
      trial_ends_at: null,
      account: sqlite.getAccountAdminDetail(account.id),
    };
  });

  app.post('/api/admin/accounts/:id/invalidate-sessions', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const account = sqlite.getAccountById(request.params.id);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    const updated = sqlite.invalidateAllSessions(account.id);
    const kicked = kickAccountAdminClients(account.id);
    return {
      ok: true,
      session_epoch: updated.session_epoch,
      sessions_invalid_after: updated.sessions_invalid_after,
      kicked,
    };
  });

  app.post('/api/admin/accounts/:id/api-keys/:keyId/revoke', async (request, reply) => {
    const auth = await requirePlatformAdmin(request, reply);
    if (!auth) return;
    const { id: accountId, keyId } = request.params;
    const account = sqlite.getAccountById(accountId);
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    const ok = sqlite.revokeApiKey(keyId, accountId);
    if (!ok) return reply.code(404).send({ error: 'API key not found' });
    const kicked = kickApiKeyDocks(keyId);
    return {
      ok: true,
      kicked,
      account: sqlite.getAccountAdminDetail(accountId),
    };
  });
}
