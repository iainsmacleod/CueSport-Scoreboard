import * as sqlite from '../db/sqlite.js';
import {
  ensureDevAccount,
  isDevAuthConfigured,
  issueDevToken,
  resolveDevAccountFromToken,
  validateDevSecret,
} from '../dev-auth.js';
import {
  roomHasConnectedDock,
  guestConnectionCounts,
  kickGuestToken,
  kickAccountAdminClients,
  kickAccountGuestClients,
  kickApiKeyDocks,
  notifyApiKeyRoleChange,
  performDeleteRoom,
  getRoomCleanupAfter,
  resolveRoomApiKeyId,
} from '../ws/room-hub.js';
import { config } from '../config.js';
import {
  assertCanCreateApiKey,
  getAccountQuota,
} from '../quotas.js';
import {
  OBS_DOCK_OWNER_GUEST_LABEL,
  isAccountAdminAuth,
  isDockOwnerGuestAuth,
  isValidDockKeyRole,
  normalizeDockKeyRole,
  permissionsForAuth,
} from '../lib/dock-roles.js';

function enrichRoom(room) {
  const cleanupMs = getRoomCleanupAfter(room.id);
  const apiKeyId = resolveRoomApiKeyId(room.id, room.api_key_id);
  const apiKey = apiKeyId ? sqlite.getApiKeyById(apiKeyId) : null;
  const apiKeyLabel = apiKey?.label || room.api_key_label || null;
  return {
    ...room,
    api_key_id: apiKeyId || null,
    api_key_label: apiKeyLabel,
    // Title is the seat name (OBS Dock Key N), never instance nicknames like "Main table".
    dock_label: apiKeyLabel || (room.dock_label !== 'Main table' && room.dock_label !== 'Default Room'
      ? room.dock_label
      : null) || apiKeyLabel || 'Connection',
    dock_connected: roomHasConnectedDock(room.id),
    cleanup_after: cleanupMs ? new Date(cleanupMs).toISOString() : null,
  };
}

export async function registerAccountRoutes(app) {
  /** Dev login — returns signed token when DEV_AUTH_SECRET is configured */
  app.post('/api/auth/dev-login', async (request, reply) => {
    if (!config.allowDevAuth) {
      return reply.code(403).send({ error: 'Dev auth disabled' });
    }
    if (!isDevAuthConfigured()) {
      return reply.code(503).send({
        error: 'Dev auth not configured (set DEV_AUTH_SECRET and DEV_AUTH_ACCOUNT_EMAIL)',
      });
    }
    const { secret } = request.body || {};
    if (!secret || typeof secret !== 'string') {
      return reply.code(400).send({ error: 'secret required' });
    }
    if (!validateDevSecret(secret)) {
      return reply.code(401).send({ error: 'Invalid dev auth secret', message: 'Invalid dev auth secret' });
    }
    const { account } = ensureDevAccount();
    const firstRoom = sqlite.getRoomsForAccount(account.id)[0] || null;
    return {
      access_token: issueDevToken(account),
      account: {
        id: account.id,
        email: account.email,
        subscription_status: account.subscription_status,
        subscription_tier: account.subscription_tier,
      },
      room: firstRoom ? { id: firstRoom.id, label: firstRoom.label } : null,
      quota: getAccountQuota(account),
    };
  });

  app.get('/api/auth/callback', async (request, reply) => {
    return reply.redirect('/web/dashboard/?auth=callback');
  });

  app.get('/api/me', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const account = auth.account;
    const rooms = sqlite.getRoomsWithLiveState(account.id).map(enrichRoom);
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
      room_cleanup: {
        grace_ms: config.roomCleanupGraceMs,
        idle_ttl_ms: config.roomIdleTtlMs,
        sweeper_ms: config.roomCleanupSweeperMs,
      },
    };
  });

  app.get('/api/players', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    const q = typeof request.query.q === 'string' ? request.query.q : '';
    const limit = request.query.limit || '8';
    const players = sqlite.searchAccountPlayers(auth.account.id, q, limit);
    return { players };
  });

  app.post('/api/rooms/:roomId/guest-link', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    const { roomId } = request.params;
    const roomErr = guestLinkRoomAccessError(auth, roomId);
    if (roomErr) return reply.code(roomErr.code).send({ error: roomErr.error });
    const perms = permissionsForAuth(auth);
    if (!perms.canCreateGuestLinks) {
      return reply.code(403).send({ error: 'This dock key cannot create guest links' });
    }
    const { label } = request.body || {};
    const requestedLabel = String(label || '').trim();
    if (!requestedLabel) {
      return reply.code(400).send({ error: 'Enter a name for this guest link.' });
    }
    if (requestedLabel === OBS_DOCK_OWNER_GUEST_LABEL) {
      const existing = sqlite.ensureDefaultDockOwnerGuestToken(roomId, auth.account.id);
      return guestLinkResponse(request, existing.token, existing.label);
    }
    const token = sqlite.createGuestToken(roomId, auth.account.id, requestedLabel);
    return guestLinkResponse(request, token, requestedLabel);
  });

  app.get('/api/guest-links', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    return { guest_links: sqlite.listGuestTokensForAccount(auth.account.id) };
  });

  app.get('/api/rooms/:roomId/guest-links', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    const { roomId } = request.params;
    const roomErr = guestLinkRoomAccessError(auth, roomId);
    if (roomErr) return reply.code(roomErr.code).send({ error: roomErr.error });
    const counts = guestConnectionCounts(roomId);
    const guest_links = sqlite.listGuestTokensForRoom(roomId, auth.account.id).map((g) => ({
      ...g,
      connected: counts[g.token] || 0,
    }));
    return { guest_links };
  });

  app.delete('/api/rooms/:roomId', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const { roomId } = request.params;
    if (!sqlite.roomBelongsToAccount(roomId, auth.account.id)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const result = performDeleteRoom(roomId);
    if (!result.ok) {
      return reply.code(404).send({ error: 'Room not found' });
    }
    return {
      ok: true,
      quota: getAccountQuota(auth.account),
      rooms: sqlite.getRoomsWithLiveState(auth.account.id).map(enrichRoom),
    };
  });

  app.delete('/api/guest-links/:token', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    const { token } = request.params;
    const existing = sqlite.findGuestToken(token);
    if (!existing || existing.account_id !== auth.account.id) {
      return reply.code(404).send({ error: 'Guest link not found' });
    }
    const roomErr = guestLinkRoomAccessError(auth, existing.room_id);
    if (roomErr) return reply.code(roomErr.code).send({ error: roomErr.error });
    const perms = permissionsForAuth(auth);
    const isDefault = sqlite.isDefaultDockOwnerGuestToken(existing);
    if (isDefault && !perms.canRevokeDefaultGuestLink) {
      return reply.code(403).send({ error: 'The default guest link cannot be revoked from a dock key' });
    }
    if (!isDefault && !perms.canRevokeGuestLinks) {
      return reply.code(403).send({ error: 'This dock key cannot revoke guest links' });
    }
    sqlite.revokeGuestToken(token, auth.account.id);
    kickGuestToken(token);
    return { ok: true };
  });

  app.post('/api/guest-links/revoke-all', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const revoked = sqlite.revokeAllGuestTokens(auth.account.id);
    kickAccountGuestClients(auth.account.id);
    return { ok: true, revoked };
  });

  // Manual room create disabled — rooms are created when an OBS dock connects.
  app.post('/api/rooms', async (_request, reply) => {
    return reply.code(410).send({
      error: 'Room creation via API is disabled',
      code: 'rooms_created_on_dock_join',
      message: 'Tables are created automatically when an OBS dock connects with an OBS Dock Key.',
    });
  });

  app.post('/api/api-keys', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const check = assertCanCreateApiKey(auth.account);
    if (!check.ok) {
      return reply.code(403).send({
        error: check.message,
        code: check.code,
        quota: check.quota,
      });
    }
    const { label, role } = request.body || {};
    const resolvedLabel = String(label || '').trim().slice(0, 40);
    if (!resolvedLabel) {
      return reply.code(400).send({ error: 'Enter a name (1–40 characters) for this dock key.' });
    }
    if (role != null && String(role).trim() && !isValidDockKeyRole(role)) {
      return reply.code(400).send({ error: 'Invalid role' });
    }
    const created = sqlite.createApiKey(auth.account.id, resolvedLabel, role);
    if (!created) {
      return reply.code(400).send({ error: 'Enter a name (1–40 characters) for this dock key.' });
    }
    return {
      id: created.id,
      key: created.plaintext,
      label: created.label,
      role: created.role,
      quota: getAccountQuota(auth.account),
    };
  });

  app.get('/api/api-keys/:keyId', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const { keyId } = request.params;
    const key = sqlite.getApiKeyPlaintext(keyId, auth.account.id);
    if (!key) {
      return reply.code(404).send({
        error: 'API key not found or was created before viewable keys. Create a new key to view it later.',
        code: 'api_key_not_viewable',
      });
    }
    return { id: keyId, key };
  });

  /** Rename and/or change role. Does not rotate the secret. */
  app.patch('/api/api-keys/:keyId', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const { keyId } = request.params;
    const { label, role } = request.body || {};
    const existing = sqlite.getApiKeyById(keyId);
    if (!existing || existing.account_id !== auth.account.id || existing.revoked_at) {
      return reply.code(404).send({ error: 'API key not found' });
    }
    const patch = {};
    if (label != null) {
      const next = String(label || '').trim();
      if (!next) {
        return reply.code(400).send({ error: 'Enter a name (1–40 characters) for this dock key.' });
      }
      patch.label = next;
    }
    if (role != null) {
      if (!isValidDockKeyRole(role)) {
        return reply.code(400).send({ error: 'Invalid role' });
      }
      patch.role = normalizeDockKeyRole(role);
    }
    if (!Object.keys(patch).length) {
      return reply.code(400).send({ error: 'Nothing to update' });
    }
    const updated = sqlite.updateApiKey(keyId, auth.account.id, patch);
    if (!updated) {
      return reply.code(400).send({ error: 'Enter a name (1–40 characters) for this dock key.' });
    }
    let notified = 0;
    if (patch.role != null) {
      notified = notifyApiKeyRoleChange(updated.id, updated.role);
    }
    return {
      ok: true,
      id: updated.id,
      label: updated.label,
      role: updated.role,
      notified,
      api_keys: sqlite.getApiKeysForAccount(auth.account.id),
      rooms: sqlite.getRoomsWithLiveState(auth.account.id).map(enrichRoom),
    };
  });

  /** Remove seat (frees quota). Create a new named key to replace a leaked one. */
  app.delete('/api/api-keys/:keyId', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const { keyId } = request.params;
    const ok = sqlite.revokeApiKey(keyId, auth.account.id);
    if (!ok) return reply.code(404).send({ error: 'API key not found' });
    const kicked = kickApiKeyDocks(keyId);
    return { ok: true, kicked, quota: getAccountQuota(auth.account) };
  });

  app.post('/api/sessions/invalidate-all', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const updated = sqlite.invalidateAllSessions(auth.account.id);
    kickAccountAdminClients(auth.account.id);
    return {
      ok: true,
      session_epoch: updated.session_epoch,
      sessions_invalid_after: updated.sessions_invalid_after,
    };
  });

  app.get('/api/config/public', async () => ({
    publicUrl: config.publicUrl,
    supabaseUrl: config.supabaseUrl || null,
    supabaseAnonKey: config.supabaseAnonKey || null,
    allowDevAuth: config.allowDevAuth,
    devAuthConfigured: isDevAuthConfigured(),
  }));
}

async function resolveAuthFromRequest(request) {
  const auth = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  const guestTokenHeader = String(request.headers['x-guest-token'] || '').trim();
  if (!token && guestTokenHeader) {
    const guest = sqlite.findGuestToken(guestTokenHeader);
    if (!guest || !sqlite.isDefaultDockOwnerGuestToken(guest)) return null;
    const account = sqlite.getAccountById(guest.account_id);
    if (!account) return null;
    return {
      account,
      authMethod: 'guest_dock_owner',
      guestToken: guest.token,
      guestRoomId: guest.room_id,
    };
  }

  const apiKeyHeader = request.headers['x-api-key'] || '';
  if (!token && apiKeyHeader) {
    const result = sqlite.findAccountByApiKey(apiKeyHeader);
    if (!result) return null;
    return {
      account: result.account,
      keyId: result.keyId,
      role: result.role,
      authMethod: 'api_key',
    };
  }

  if (!token) return null;

  if (token.startsWith('dev:')) {
    const account = resolveDevAccountFromToken(token);
    if (!account) return null;
    return { account, authMethod: 'dev' };
  }

  const { authenticateJoin } = await import('../ws/auth.js');
  const result = await authenticateJoin({ accessToken: token, client: 'dashboard' });
  if (result.error) return null;
  return { account: result.account, authMethod: result.authMethod || 'jwt' };
}

async function resolveAccountFromRequest(request) {
  const auth = await resolveAuthFromRequest(request);
  return auth?.account || null;
}

function guestLinkRoomAccessError(auth, roomId) {
  if (!sqlite.roomBelongsToAccount(roomId, auth.account.id)) {
    return { code: 403, error: 'Forbidden' };
  }
  if (isAccountAdminAuth(auth)) return null;
  if (isDockOwnerGuestAuth(auth)) {
    if (auth.guestRoomId !== roomId) {
      return { code: 403, error: 'Forbidden' };
    }
    return null;
  }
  const ownRoomId = sqlite.getRoomIdForApiKey(auth.keyId);
  if (!ownRoomId || ownRoomId !== roomId) {
    return { code: 403, error: 'Forbidden' };
  }
  return null;
}

function guestLinkResponse(request, token, label) {
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
    label,
  };
}

export { resolveAccountFromRequest, resolveAuthFromRequest };
