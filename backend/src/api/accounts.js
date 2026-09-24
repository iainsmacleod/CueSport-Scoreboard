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
  roomHasConnectedAuthority,
  roomHasConnectedGuest,
  guestConnectionCounts,
  kickGuestToken,
  kickAccountAdminClients,
  kickAccountGuestClients,
  revokeApiKeySeat,
  notifyApiKeyRoleChange,
  performDeleteRoom,
  getRoomCleanupAfter,
  resolveRoomApiKeyId,
  notifyAccountTables,
  resetAccountSeatsForPlanDowngrade,
} from '../ws/room-hub.js';
import { config } from '../config.js';
import {
  assertCanCreateApiKey,
  assertCanCreateImpromptuTable,
  getAccountQuota,
  getSimulatedPlanOptions,
  getTierDisplayName,
  isTierDowngrade,
  resolveSimulatedPlan,
  getTiersCatalog,
} from '../quotas.js';
import {
  OBS_DOCK_OWNER_GUEST_LABEL,
  isAccountAdminAuth,
  isDockOwnerGuestAuth,
  isValidDockKeyRole,
  normalizeDockKeyRole,
  permissionsForAuth,
} from '../lib/dock-roles.js';
import { isPlatformAdmin } from '../lib/platform-admin.js';
import { hasCloudSubscriptionAccess, isAdminSupportTrialActive } from '../lib/subscription-access.js';
import { getSubscriptionBillingSummary, isStripeConfigured } from '../lib/stripe-billing.js';

function enrichRoom(room) {
  const kind = room.kind === 'impromptu' ? 'impromptu' : 'dock';
  const cleanupMs = kind === 'dock' ? getRoomCleanupAfter(room.id) : null;
  const apiKeyId = kind === 'dock' ? resolveRoomApiKeyId(room.id, room.api_key_id) : null;
  const apiKey = apiKeyId ? sqlite.getApiKeyById(apiKeyId) : null;
  const apiKeyLabel = apiKey?.label || room.api_key_label || null;
  const authorityConnected = roomHasConnectedAuthority(room.id);
  const dockConnected = kind === 'dock' ? roomHasConnectedDock(room.id) : false;
  const guestConnected = roomHasConnectedGuest(room.id);
  return {
    ...room,
    kind,
    api_key_id: apiKeyId || null,
    api_key_label: apiKeyLabel,
    // Title is the seat name (OBS Dock Key N), never instance nicknames like "Main table".
    dock_label: kind === 'impromptu'
      ? (room.label || 'Ad-hoc Table')
      : (apiKeyLabel || (room.dock_label !== 'Main table' && room.dock_label !== 'Default Room'
        ? room.dock_label
        : null) || apiKeyLabel || 'Connection'),
    dock_connected: dockConnected,
    authority_connected: authorityConnected,
    guest_connected: guestConnected,
    live: kind === 'impromptu' ? authorityConnected : dockConnected,
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
    const hasAccess = hasCloudSubscriptionAccess(account);
    const status = String(account.subscription_status || '').toLowerCase();
    const platformAdmin = isPlatformAdmin(account);
    const canSimulatePlan = platformAdmin || config.allowDevAuth;
    const quota = getAccountQuota(account);
    const complimentary = isAdminSupportTrialActive(account);
    let billingSummary = null;
    try {
      billingSummary = await getSubscriptionBillingSummary(account);
    } catch {
      billingSummary = null;
    }
    return {
      account: {
        id: account.id,
        email: account.email,
        subscription_status: account.subscription_status,
        subscription_tier: account.subscription_tier,
        subscription_tier_display: getTierDisplayName(account.subscription_tier),
        trial_ends_at: account.trial_ends_at || null,
        stripe_customer_id: account.stripe_customer_id || null,
        stripe_subscription_id: account.stripe_subscription_id || null,
        has_subscription_access: hasAccess,
        is_complimentary: complimentary,
        needs_plan: !hasAccess && !config.allowDevAuth,
        is_trialing: status === 'trialing',
        simulated_plan: canSimulatePlan ? resolveSimulatedPlan(account) : null,
        billing_summary: billingSummary,
      },
      is_platform_admin: platformAdmin,
      can_simulate_plan: canSimulatePlan,
      simulated_plan_options: canSimulatePlan ? getSimulatedPlanOptions() : null,
      billing: {
        stripeConfigured: isStripeConfigured() && !config.allowDevAuth,
        plansUrl: '/api/billing/plans',
        termsUrl: `${config.publicUrl}/terms`,
        privacyUrl: `${config.publicUrl}/privacy`,
      },
      rooms,
      api_keys: keys,
      quota,
      room_cleanup: {
        grace_ms: config.roomCleanupGraceMs,
        idle_ttl_ms: config.roomIdleTtlMs,
        sweeper_ms: config.roomCleanupSweeperMs,
      },
    };
  });

  app.patch('/api/me/simulated-plan', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const canSimulatePlan = isPlatformAdmin(auth.account) || config.allowDevAuth;
    if (!canSimulatePlan) {
      return reply.code(403).send({ error: 'Simulated plan is only available for platform admins or self-host owners' });
    }
    const previousPlan = resolveSimulatedPlan(auth.account);
    const requested = String(request.body?.tier ?? request.body?.simulated_plan ?? '').trim().toLowerCase();
    let nextPlan = 'unrestricted';
    if (!requested || requested === 'unrestricted' || requested === 'platform_admin') {
      sqlite.setAccountSimulatedPlan(auth.account.id, null);
      nextPlan = 'unrestricted';
    } else {
      const catalog = getTiersCatalog();
      if (!catalog[requested]) {
        return reply.code(400).send({ error: 'Unknown tier' });
      }
      sqlite.setAccountSimulatedPlan(auth.account.id, requested);
      nextPlan = requested;
    }
    let seatReset = null;
    if (isTierDowngrade(previousPlan, nextPlan)) {
      seatReset = resetAccountSeatsForPlanDowngrade(auth.account.id);
      request.log?.info?.(
        { accountId: auth.account.id, from: previousPlan, to: nextPlan, ...seatReset },
        'simulated plan downgrade reset seats',
      );
    }
    const account = sqlite.getAccountById(auth.account.id);
    return {
      ok: true,
      simulated_plan: resolveSimulatedPlan(account),
      quota: getAccountQuota(account),
      seat_reset: seatReset,
      account: {
        id: account.id,
        email: account.email,
        simulated_plan: resolveSimulatedPlan(account),
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

  app.post('/api/players', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!permissionsForAuth(auth).canManagePlayers) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const player = sqlite.createAccountPlayer(auth.account.id, request.body?.name);
    if (!player) {
      return reply.code(400).send({ error: 'Enter a player name.' });
    }
    return reply.code(201).send({ player });
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
      return reply.code(404).send({ error: 'Table not found' });
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

  // Ad-hoc (dockless) tables only — dock rooms are still created on OBS dock join.
  app.post('/api/rooms', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const kind = String(request.body?.kind || '').trim().toLowerCase();
    if (kind !== 'impromptu') {
      return reply.code(410).send({
        error: 'Table creation via API is disabled for OBS dock seats',
        code: 'rooms_created_on_dock_join',
        message: 'OBS tables are created automatically when a dock connects with an OBS Dock Key. Use kind=impromptu for dockless tables.',
      });
    }
    if (!hasCloudSubscriptionAccess(auth.account)) {
      return reply.code(403).send({
        error: 'An active subscription or trial is required to create ad-hoc tables. Choose a plan to continue.',
        code: 'subscription_required',
      });
    }
    const check = assertCanCreateImpromptuTable(auth.account);
    if (!check.ok) {
      return reply.code(403).send({
        error: check.message,
        code: check.code,
        quota: check.quota,
      });
    }
    const label = String(request.body?.label || 'Ad-hoc Table').trim().slice(0, 60) || 'Ad-hoc Table';
    const room = sqlite.createImpromptuRoom(auth.account.id, label);
    if (!room) {
      return reply.code(500).send({ error: 'Could not create ad-hoc table' });
    }
    sqlite.createGuestToken(room.id, auth.account.id, 'Guest scorer');
    const sessionState = sqlite.getRoomSessionState(room.id);
    notifyAccountTables(auth.account.id, { immediate: true });
    return {
      room: enrichRoom({
        ...room,
        kind: 'impromptu',
        live_state: sessionState.state || {},
        guest_link_count: sqlite.countActiveGuestTokensForRoom(room.id),
      }),
      quota: getAccountQuota(auth.account),
    };
  });

  app.post('/api/api-keys', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    if (!hasCloudSubscriptionAccess(auth.account)) {
      if (auth.account.trial_ends_at) {
        const { enforceComplimentaryExpiryForAccount } = await import('../lib/complimentary-expiry.js');
        await enforceComplimentaryExpiryForAccount(auth.account.id).catch(() => {});
      }
      return reply.code(403).send({
        error: 'An active subscription or trial is required to create OBS Dock Keys. Choose a plan to continue.',
        code: 'subscription_required',
      });
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
    if (sqlite.isApiKeyLabelInUse(auth.account.id, resolvedLabel)) {
      return reply.code(409).send({
        error: 'Dock Key names must be unique. Choose a different name or label.',
        code: 'duplicate_key_label',
      });
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
      const next = String(label || '').trim().slice(0, 40);
      if (!next) {
        return reply.code(400).send({ error: 'Enter a name (1–40 characters) for this dock key.' });
      }
      if (sqlite.isApiKeyLabelInUse(auth.account.id, next, keyId)) {
        return reply.code(409).send({
          error: 'Dock Key names must be unique. Choose a different name or label.',
          code: 'duplicate_key_label',
        });
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
    const { kicked, roomDeleted } = revokeApiKeySeat(keyId);
    return {
      ok: true,
      kicked,
      room_deleted: roomDeleted,
      quota: getAccountQuota(auth.account),
      api_keys: sqlite.getApiKeysForAccount(auth.account.id),
      rooms: sqlite.getRoomsWithLiveState(auth.account.id).map(enrichRoom),
    };
  });

  app.post('/api/api-keys/revoke-all', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const keyIds = sqlite.revokeAllApiKeysForAccount(auth.account.id);
    let kicked = 0;
    let roomsDeleted = 0;
    for (const keyId of keyIds) {
      try {
        const result = revokeApiKeySeat(keyId);
        kicked += Number(result.kicked) || 0;
        if (result.roomDeleted) roomsDeleted += 1;
      } catch (err) {
        // The database revocation is authoritative. A stale room/socket must not
        // turn a successful bulk revoke into a 500 that leaves the UI unchanged.
        request.log.warn({ err, keyId }, 'Could not clean up revoked OBS Dock Key seat');
      }
    }
    return {
      ok: true,
      revoked: keyIds.length,
      kicked,
      rooms_deleted: roomsDeleted,
      quota: getAccountQuota(auth.account),
      api_keys: sqlite.getApiKeysForAccount(auth.account.id),
      rooms: sqlite.getRoomsWithLiveState(auth.account.id).map(enrichRoom),
    };
  });

  app.post('/api/sessions/invalidate-all', async (request, reply) => {
    const auth = await resolveAuthFromRequest(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const accountId = auth.account.id;
    const guestsRevoked = sqlite.revokeAllGuestTokens(accountId);
    const guestsKicked = kickAccountGuestClients(accountId);
    const updated = sqlite.invalidateAllSessions(accountId);
    const adminsKicked = kickAccountAdminClients(accountId);
    return {
      ok: true,
      session_epoch: updated.session_epoch,
      sessions_invalid_after: updated.sessions_invalid_after,
      guests_revoked: guestsRevoked,
      guests_kicked: guestsKicked,
      admins_kicked: adminsKicked,
    };
  });

  app.get('/api/config/public', async () => ({
    publicUrl: config.publicUrl,
    supabaseUrl: config.supabaseUrl || null,
    supabasePublishableKey: config.supabasePublishableKey || null,
    /** Google Web Client ID for official GIS button (optional; falls back to Supabase OAuth redirect). */
    googleOAuthClientId: config.googleOAuthClientId || null,
    allowDevAuth: config.allowDevAuth,
    devAuthConfigured: isDevAuthConfigured(),
    termsUrl: `${config.publicUrl}/terms`,
    privacyUrl: `${config.publicUrl}/privacy`,
    supportIssuesUrl: config.supportIssuesUrl,
    billingEnabled: isStripeConfigured() && !config.allowDevAuth,
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
    if (!account || sqlite.isAccountDeleting(account) || sqlite.isEmailBlocked(account.email)) return null;
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
    if (!result || sqlite.isAccountDeleting(result.account) || sqlite.isEmailBlocked(result.account.email)) return null;
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
    if (!account || sqlite.isAccountDeleting(account) || sqlite.isEmailBlocked(account.email)) return null;
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
