import * as sqlite from '../db/sqlite.js';
import {
  ensureDevAccount,
  isDevAuthConfigured,
  issueDevToken,
  resolveDevAccountFromToken,
  validateDevSecret,
} from '../dev-auth.js';
import { ensureAccountFromOAuth } from '../ws/auth.js';
import { roomHasConnectedDock, guestConnectionCounts, kickGuestToken, kickAccountAdminClients, kickAccountGuestClients } from '../ws/room-hub.js';
import { config } from '../config.js';
import {
  assertCanCreateApiKey,
  assertCanCreateRoom,
  getAccountQuota,
} from '../quotas.js';

export async function registerAccountRoutes(app) {
  /** Dev login — returns signed token when DEV_AUTH_SECRET is configured */
  app.post('/api/auth/dev-login', async (request, reply) => {
    if (!config.allowDevAuth) {
      return reply.code(403).send({ error: 'Dev auth disabled' });
    }
    if (!isDevAuthConfigured()) {
      return reply.code(503).send({ error: 'Dev auth not configured (set DEV_AUTH_SECRET)' });
    }
    const { secret } = request.body || {};
    if (!secret || typeof secret !== 'string') {
      return reply.code(400).send({ error: 'secret required' });
    }
    if (!validateDevSecret(secret)) {
      return reply.code(401).send({ error: 'Invalid dev auth secret', message: 'Invalid dev auth secret' });
    }
    const { account, room } = ensureDevAccount();
    let apiKey = sqlite.getApiKeysForAccount(account.id)[0];
    let apiKeyPlain = null;
    if (!apiKey) {
      const check = assertCanCreateApiKey(account);
      if (!check.ok) {
        return reply.code(403).send({
          error: check.message,
          code: check.code,
          quota: check.quota,
        });
      }
      const created = sqlite.createApiKey(account.id);
      apiKeyPlain = created.plaintext;
    }
    return {
      access_token: issueDevToken(account),
      account: {
        id: account.id,
        email: account.email,
        subscription_status: account.subscription_status,
        subscription_tier: account.subscription_tier,
      },
      room: { id: room.id, label: room.label },
      api_key: apiKeyPlain,
      quota: getAccountQuota(account),
    };
  });

  app.get('/api/auth/callback', async (request, reply) => {
    return reply.redirect('/web/dashboard/?auth=callback');
  });

  app.get('/api/me', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const rooms = sqlite.getRoomsWithLiveState(account.id).map((room) => ({
      ...room,
      dock_connected: roomHasConnectedDock(room.id),
    }));
    const keys = sqlite.getApiKeysForAccount(account.id);
    return {
      account: {
        id: account.id,
        email: account.email,
        subscription_status: account.subscription_status,
        subscription_tier: account.subscription_tier,
      },
      rooms,
      api_keys: keys,
      quota: getAccountQuota(account),
    };
  });

  app.get('/api/players', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const q = typeof request.query.q === 'string' ? request.query.q : '';
    const limit = request.query.limit || '8';
    const players = sqlite.searchAccountPlayers(account.id, q, limit);
    return { players };
  });

  app.post('/api/rooms/:roomId/guest-link', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { roomId } = request.params;
    if (!sqlite.roomBelongsToAccount(roomId, account.id)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const { label } = request.body || {};
    const token = sqlite.createGuestToken(roomId, account.id, label || 'Guest scorer');
    const xfProto = request.headers['x-forwarded-proto'];
    const xfHost = request.headers['x-forwarded-host'] || request.headers.host;
    let base = config.publicUrl.replace(/\/$/, '');
    if (xfHost) {
      const proto = (Array.isArray(xfProto) ? xfProto[0] : xfProto) ||
        (request.protocol === 'https' ? 'https' : 'http');
      const host = String(Array.isArray(xfHost) ? xfHost[0] : xfHost).split(',')[0].trim();
      base = `${proto}://${host}`.replace(/\/$/, '');
    }
    return {
      token,
      path: `/g/${token}`,
      url: `${base}/g/${token}`,
      label: label || 'Guest scorer',
    };
  });

  app.get('/api/guest-links', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    return { guest_links: sqlite.listGuestTokensForAccount(account.id) };
  });

  app.get('/api/rooms/:roomId/guest-links', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { roomId } = request.params;
    if (!sqlite.roomBelongsToAccount(roomId, account.id)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const counts = guestConnectionCounts(roomId);
    const guest_links = sqlite.listGuestTokensForRoom(roomId, account.id).map((g) => ({
      ...g,
      connected: counts[g.token] || 0,
    }));
    return { guest_links };
  });

  app.delete('/api/guest-links/:token', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { token } = request.params;
    const existing = sqlite.findGuestToken(token);
    if (!existing || existing.account_id !== account.id) {
      return reply.code(404).send({ error: 'Guest link not found' });
    }
    sqlite.revokeGuestToken(token, account.id);
    kickGuestToken(token);
    return { ok: true };
  });

  app.post('/api/guest-links/revoke-all', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const revoked = sqlite.revokeAllGuestTokens(account.id);
    kickAccountGuestClients(account.id);
    return { ok: true, revoked };
  });

  app.post('/api/rooms', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const check = assertCanCreateRoom(account);
    if (!check.ok) {
      return reply.code(403).send({
        error: check.message,
        code: check.code,
        quota: check.quota,
      });
    }
    const { label } = request.body || {};
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    sqlite.getDb().prepare('INSERT INTO rooms (id, account_id, label) VALUES (?, ?, ?)').run(
      id, account.id, label || 'Room'
    );
    return sqlite.getRoom(id);
  });

  app.post('/api/api-keys', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const check = assertCanCreateApiKey(account);
    if (!check.ok) {
      return reply.code(403).send({
        error: check.message,
        code: check.code,
        quota: check.quota,
      });
    }
    const { label } = request.body || {};
    const created = sqlite.createApiKey(account.id, label || 'API Key');
    return {
      id: created.id,
      key: created.plaintext,
      label: label || 'API Key',
      quota: getAccountQuota(account),
    };
  });

  app.delete('/api/api-keys/:keyId', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { keyId } = request.params;
    const ok = sqlite.revokeApiKey(keyId, account.id);
    if (!ok) return reply.code(404).send({ error: 'API key not found' });
    return { ok: true, quota: getAccountQuota(account) };
  });

  app.post('/api/sessions/invalidate-all', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const updated = sqlite.invalidateAllSessions(account.id);
    kickAccountAdminClients(account.id);
    return {
      ok: true,
      session_epoch: updated.session_epoch,
      sessions_invalid_after: updated.sessions_invalid_after,
    };
  });

  app.get('/api/config/public', async () => ({
    publicUrl: config.publicUrl,
    supabaseUrl: config.supabaseUrl || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    allowDevAuth: config.allowDevAuth,
    devAuthConfigured: isDevAuthConfigured(),
  }));
}

async function resolveAccountFromRequest(request) {
  const auth = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  if (token.startsWith('dev:')) {
    return resolveDevAccountFromToken(token);
  }

  const { authenticateJoin } = await import('../ws/auth.js');
  const result = await authenticateJoin({ accessToken: token, client: 'dashboard' });
  if (result.error) return null;
  return result.account;
}

export { resolveAccountFromRequest };
