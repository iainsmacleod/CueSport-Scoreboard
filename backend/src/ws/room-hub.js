import { v4 as uuidv4 } from 'uuid';
import * as sqlite from '../db/sqlite.js';
import { getAccountStats } from '../stats/account-stats.js';
import { config } from '../config.js';
import {
  assertCanCreateRoom,
  getMaxControlConnections,
  isControlClient,
} from '../quotas.js';
import { permissionsForAuth } from '../lib/dock-roles.js';

/** roomId -> Set<{ ws, client, accountId, sourceId }> */
const rooms = new Map();

/** ws -> connection meta */
const connections = new Map();

/** apiKeyId -> Set<ws> for fast revoke/kick (Option A seats) */
const docksByApiKeyId = new Map();

/** accountId -> Set<ws> for dashboard live table feeds */
const accountDashboards = new Map();

/** accountId -> debounce timer for tables push after state churn */
const tablesNotifyTimers = new Map();

/** roomId -> timeout handle for grace-period cleanup */
const roomCleanupTimers = new Map();

/** roomId -> epoch ms when grace cleanup is due (for debug UI) */
const roomCleanupAfter = new Map();

/** roomIds currently being deleted (skip reschedule on WS close) */
const roomsBeingDeleted = new Set();

let sweeperTimer = null;

function getRoomClients(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  return rooms.get(roomId);
}

/** Remove a ws from a room client Set without mutating during for-of iteration. */
function removeRoomClientByWs(clients, ws) {
  if (!clients || !ws) return;
  for (const c of Array.from(clients)) {
    if (c.ws === ws) clients.delete(c);
  }
}

function broadcast(roomId, message, excludeWs = null) {
  const clients = getRoomClients(roomId);
  const data = JSON.stringify(message);
  for (const conn of clients) {
    if (conn.ws !== excludeWs && conn.ws.readyState === 1) {
      conn.ws.send(data);
    }
  }
}

function listClientTypes(roomId) {
  const types = new Set();
  for (const conn of getRoomClients(roomId)) {
    types.add(conn.client);
  }
  return [...types];
}

function send(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function trackDockApiKey(ws, keyId) {
  if (!ws || !keyId) return;
  let set = docksByApiKeyId.get(keyId);
  if (!set) {
    set = new Set();
    docksByApiKeyId.set(keyId, set);
  }
  set.add(ws);
}

function untrackDockApiKey(ws, keyId) {
  if (!ws || !keyId) return;
  const set = docksByApiKeyId.get(keyId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) docksByApiKeyId.delete(keyId);
}

function findDockUsingApiKey(keyId, excludeWs = null) {
  if (!keyId) return null;
  const set = docksByApiKeyId.get(keyId);
  if (set) {
    for (const ws of set) {
      if (excludeWs && ws === excludeWs) continue;
      if (ws.readyState === 1) {
        const meta = connections.get(ws);
        if (meta) return { ws, meta };
      }
    }
  }
  // Fallback scan (in case index missed an in-flight join)
  for (const [ws, meta] of connections) {
    if (excludeWs && ws === excludeWs) continue;
    if (meta.apiKeyId !== keyId) continue;
    if (ws.readyState === 1) return { ws, meta };
  }
  return null;
}

const API_KEY_IN_USE_MESSAGE =
  'This OBS Dock Key is already in use by another dock. Create a new key in Account settings on the Cloud dashboard and paste it into this dock.';

/**
 * If this key already has a live dock, return an error for the incoming join.
 * Does not disconnect the existing dock (avoids disrupting an active match/stats).
 */
function apiKeyDockSeatConflict(keyId, incomingWs) {
  if (!keyId) return null;
  if (!findDockUsingApiKey(keyId, incomingWs)) return null;
  return { error: 'api_key_in_use', message: API_KEY_IN_USE_MESSAGE };
}

function findLiveDockApiKeyId(roomId) {
  if (!roomId) return null;
  for (const [, meta] of connections) {
    if (meta.roomId === roomId && meta.client === 'dock' && meta.apiKeyId) {
      return meta.apiKeyId;
    }
  }
  return null;
}

/** Resolve seat key for a room (DB mapping, else live dock) and backfill DB when possible. */
export function resolveRoomApiKeyId(roomId, existingApiKeyId = null) {
  const liveKeyId = findLiveDockApiKeyId(roomId);
  const keyId = existingApiKeyId || liveKeyId;
  if (liveKeyId && liveKeyId !== existingApiKeyId) {
    sqlite.setRoomDockApiKey(roomId, liveKeyId);
  }
  return keyId || null;
}

function buildDashboardRooms(accountId) {
  return sqlite.getRoomsWithLiveState(accountId).map((room) => {
    const keyId = resolveRoomApiKeyId(room.id, room.api_key_id);
    const apiKey = keyId ? sqlite.getApiKeyById(keyId) : null;
    const keyLabel = apiKey?.label || room.api_key_label || null;
    return {
      ...room,
      api_key_id: keyId || null,
      api_key_label: keyLabel,
      dock_label: keyLabel || room.dock_label,
      dock_connected: roomHasConnectedDock(room.id),
      cleanup_after: roomCleanupAfter.get(room.id)
        ? new Date(roomCleanupAfter.get(room.id)).toISOString()
        : null,
    };
  });
}

function addAccountDashboard(accountId, ws) {
  if (!accountDashboards.has(accountId)) accountDashboards.set(accountId, new Set());
  accountDashboards.get(accountId).add(ws);
}

function removeAccountDashboard(accountId, ws) {
  const set = accountDashboards.get(accountId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) accountDashboards.delete(accountId);
}

/** Push full tables snapshot to any open dashboards for this account. */
export function notifyAccountTables(accountId, { immediate = false } = {}) {
  if (!accountId || !accountDashboards.has(accountId)) return;

  const flush = () => {
    tablesNotifyTimers.delete(accountId);
    const set = accountDashboards.get(accountId);
    if (!set || !set.size) return;
    const message = { type: 'tables', rooms: buildDashboardRooms(accountId) };
    for (const ws of set) send(ws, message);
  };

  if (immediate) {
    const pending = tablesNotifyTimers.get(accountId);
    if (pending) clearTimeout(pending);
    flush();
    return;
  }

  if (tablesNotifyTimers.has(accountId)) return;
  tablesNotifyTimers.set(accountId, setTimeout(flush, 250));
}

export function handleConnection(ws) {
  const sourceId = uuidv4();
  connections.set(ws, { roomId: null, client: null, accountId: null, sourceId, apiKeyId: null });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', code: 'invalid_json', message: 'Invalid JSON' });
      return;
    }

    const meta = connections.get(ws);
    if (!meta) return;

    try {
      await handleMessage(ws, meta, msg);
    } catch (err) {
      console.error('WS message error:', err);
      send(ws, { type: 'error', code: 'server_error', message: err.message || 'Server error' });
    }
  });

  ws.on('close', () => {
    const meta = connections.get(ws);
    if (!meta) return;

    if (meta.apiKeyId) {
      untrackDockApiKey(ws, meta.apiKeyId);
    }

    if (meta.client === 'dashboard' && meta.accountId) {
      removeAccountDashboard(meta.accountId, ws);
    }

    if (meta.roomId) {
      const wasDock = meta.client === 'dock';
      const accountId = meta.accountId;
      const roomId = meta.roomId;
      const clients = getRoomClients(roomId);
      removeRoomClientByWs(clients, ws);
      broadcast(roomId, {
        type: 'presence',
        room_id: roomId,
        clients: listClientTypes(roomId),
      });
      if (wasDock && accountId) {
        notifyAccountTables(accountId, { immediate: true });
        if (!roomsBeingDeleted.has(roomId) && !roomHasConnectedDock(roomId)) {
          scheduleRoomCleanup(roomId);
        }
      }
    }
    connections.delete(ws);
  });
}

async function handleMessage(ws, meta, msg) {
  const { authenticateJoin } = await import('./auth.js');

  switch (msg.type) {
    case 'join':
      return handleJoin(ws, meta, msg, authenticateJoin);
    case 'event':
      return handleEvent(ws, meta, msg);
    case 'command':
      return handleCommand(ws, meta, msg);
    case 'state':
      return handleState(ws, meta, msg);
    case 'session':
      return handleSession(ws, meta, msg);
    case 'stats':
      return handleStats(ws, meta, msg);
    case 'disconnect':
      return ws.close();
    default:
      send(ws, { type: 'error', code: 'unknown_type', message: `Unknown message type: ${msg.type}` });
  }
}

/** Dock/mobile account stats over WS (avoids browser CORS from file:// OBS docks). */
function handleStats(ws, meta, msg) {
  const requestId = msg.request_id || null;
  if (!meta.accountId) {
    send(ws, { type: 'stats', request_id: requestId, ok: false, error: 'Unauthorized' });
    return;
  }
  if (meta.client === 'mobile_guest') {
    send(ws, { type: 'stats', request_id: requestId, ok: false, error: 'Forbidden' });
    return;
  }
  try {
    const limit = Math.min(Math.max(parseInt(msg.limit || 5000, 10) || 5000, 1), 10000);
    const stats = getAccountStats(meta.accountId, limit);
    const auth = {
      account: { id: meta.accountId },
      authMethod: meta.authMethod || (meta.apiKeyId ? 'api_key' : 'jwt'),
      keyId: meta.apiKeyId || null,
      role: meta.role || null,
    };
    send(ws, {
      type: 'stats',
      request_id: requestId,
      ok: true,
      role: meta.role || null,
      permissions: permissionsForAuth(auth),
      ...stats,
    });
  } catch (err) {
    send(ws, {
      type: 'stats',
      request_id: requestId,
      ok: false,
      error: err?.message || 'Stats failed',
    });
  }
}

/** Commands allowed for guest scorer links (no names or replay). */
const GUEST_ALLOWED_COMMANDS = new Set([
  'score_add', 'score_sub', 'balls_add', 'balls_sub',
  // Object balls + action row: foul, undo, free ball (via snooker_ball), respot, player switch.
  'player_slot', 'select_breaker', 'toggle_active_player',
  'toggle_pot', 'snooker_ball', 'snooker_foul', 'undo',
  'pool_foul', 'respot_ball',
  'set_race', 'set_game_info', 'set_game_type',
  'set_ball_selection', 'set_early_game_ball', 'set_snooker_gold', 'set_point_based',
  // Restart / End / Call Match Early (same match controls as admin remote).
  'reset_scores', 'end_match', 'call_match_early',
]);

function findLiveGuestToken(token, excludeWs = null) {
  if (!token) return null;
  for (const [ws, meta] of connections) {
    if (excludeWs && ws === excludeWs) continue;
    if (meta.client !== 'mobile_guest' || meta.guestToken !== token) continue;
    if (ws.readyState === 1) return { ws, meta };
  }
  return null;
}

const GUEST_LINK_IN_USE_MESSAGE =
  'This guest link is already in use on another device. Wait for that session to disconnect, or create a new guest link.';

/** One live socket per guest token; reject additional joins without kicking the first. */
function guestTokenSessionConflict(token, incomingWs) {
  if (!token) return null;
  if (!findLiveGuestToken(token, incomingWs)) return null;
  return { error: 'guest_link_in_use', message: GUEST_LINK_IN_USE_MESSAGE };
}

function countControlConnections(roomId, excludeWs = null) {
  let n = 0;
  for (const conn of getRoomClients(roomId)) {
    if (!isControlClient(conn.client)) continue;
    if (excludeWs && conn.ws === excludeWs) continue;
    if (conn.ws.readyState === 1) n += 1;
  }
  return n;
}

function resolveRoomIdForJoin(msg, auth, client) {
  // Dock tables are keyed by OBS Dock Key (api_key_id), not ?instance=.
  if (client === 'dock' && auth?.account && auth.keyId) {
    const apiKeyId = auth.keyId;
    const existing = sqlite.peekRoomDockByApiKey(apiKeyId);
    if (existing) {
      const room = sqlite.ensureRoomForApiKey(auth.account.id, apiKeyId, {
        instanceKey: msg.instance_id || 'default',
        label: msg.instance_label || null,
      });
      if (!room) {
        return { error: 'room_forbidden', message: 'No access to this room' };
      }
      return { roomId: room.id };
    }
    const check = assertCanCreateRoom(auth.account);
    if (!check.ok) {
      return { error: check.code, message: check.message, quota: check.quota };
    }
    const room = sqlite.ensureRoomForApiKey(auth.account.id, apiKeyId, {
      instanceKey: msg.instance_id || 'default',
      label: msg.instance_label || null,
    });
    if (!room) {
      return { error: 'room_create_failed', message: 'Could not create table for this Dock Key' };
    }
    return { roomId: room.id };
  }
  let roomId = msg.room_id || msg.room || null;
  if (!roomId && client === 'dock' && auth?.account) {
    const roomsForAccount = sqlite.getRoomsForAccount(auth.account.id);
    if (roomsForAccount.length) roomId = roomsForAccount[0].id;
  }
  return { roomId };
}

async function handleJoin(ws, meta, msg, authenticateJoin) {
  const client = msg.client || 'dock';

  if (client === 'dashboard') {
    return handleDashboardJoin(ws, meta, msg, authenticateJoin);
  }

  return handleRoomClientJoin(ws, meta, msg, authenticateJoin);
}

/** Account-scoped dashboard feed: no room join; push tables on dock/state changes. */
async function handleDashboardJoin(ws, meta, msg, authenticateJoin) {
  if (msg.api_key && !msg.access_token) {
    send(ws, {
      type: 'error',
      code: 'dashboard_jwt_required',
      message: 'The dashboard requires account sign-in (not an OBS Dock Key).',
    });
    return;
  }
  const auth = await authenticateJoin({
    apiKey: null,
    accessToken: msg.access_token,
    client: 'dashboard',
  });
  if (auth.error) {
    send(ws, { type: 'error', code: auth.error, message: auth.message });
    return;
  }
  if (meta.client === 'dashboard' && meta.accountId) {
    removeAccountDashboard(meta.accountId, ws);
  }
  if (meta.roomId) {
    const old = getRoomClients(meta.roomId);
    removeRoomClientByWs(old, ws);
  }
  const accountId = auth.account.id;
  meta.accountId = accountId;
  meta.client = 'dashboard';
  meta.roomId = null;
  addAccountDashboard(accountId, ws);
  send(ws, {
    type: 'joined',
    client: 'dashboard',
    account_id: accountId,
    rooms: buildDashboardRooms(accountId),
  });
}

/** Dock, mobile, or guest join into a room. */
async function handleRoomClientJoin(ws, meta, msg, authenticateJoin) {
  let client = msg.client || 'dock';
  let roomId = msg.room_id || msg.room;
  let accountId = null;

  if (msg.guest_token) {
    const guest = sqlite.findGuestToken(msg.guest_token);
    if (!guest) {
      send(ws, { type: 'error', code: 'invalid_guest_token', message: 'Invalid or expired guest link' });
      return;
    }
    const conflict = guestTokenSessionConflict(msg.guest_token, ws);
    if (conflict) {
      send(ws, { type: 'error', code: conflict.error, message: conflict.message });
      return;
    }
    roomId = guest.room_id;
    accountId = guest.account_id;
    client = 'mobile_guest';
    meta.client = client;
    meta.accountId = accountId;
    meta.guestToken = msg.guest_token;
    meta.isDockOwnerGuest = sqlite.isDefaultDockOwnerGuestToken(guest);
    meta.guestLabel = guest.label || null;
  } else {
    // Docks must use an OBS Dock Key (same seat model for hosted + self-host).
    if (client === 'dock' && !msg.api_key) {
      send(ws, {
        type: 'error',
        code: 'dock_key_required',
        message: 'OBS docks must connect with an OBS Dock Key from the dashboard (Account → OBS Dock Keys).',
      });
      return;
    }

    const auth = await authenticateJoin({
      apiKey: msg.api_key,
      accessToken: msg.access_token,
      roomId,
      client,
    });

    if (auth.error) {
      send(ws, { type: 'error', code: auth.error, message: auth.message });
      return;
    }

    // Option A: one key = one dock. Reject if another dock already holds this key.
    if (client === 'dock' && auth.authMethod === 'api_key' && auth.keyId) {
      const conflict = apiKeyDockSeatConflict(auth.keyId, ws);
      if (conflict) {
        send(ws, { type: 'error', code: conflict.error, message: conflict.message });
        return;
      }
      meta.apiKeyId = auth.keyId;
      meta.role = auth.role || null;
      meta.authMethod = auth.authMethod;
      meta.client = 'dock';
      trackDockApiKey(ws, auth.keyId);
    }

    if (auth.authMethod) {
      meta.authMethod = auth.authMethod;
    }
    if (auth.role) {
      meta.role = auth.role;
    }

    roomId = resolveRoomIdForJoin(msg, auth, client);
    if (roomId && typeof roomId === 'object' && roomId.error) {
      send(ws, { type: 'error', code: roomId.error, message: roomId.message, quota: roomId.quota });
      return;
    }
    if (roomId && typeof roomId === 'object') {
      roomId = roomId.roomId;
    }
    if (!roomId) {
      send(ws, { type: 'error', code: 'room_required', message: 'room_id is required' });
      return;
    }

    accountId = auth.account.id;
    meta.accountId = accountId;

    if (client === 'dock' && meta.apiKeyId) {
      sqlite.touchRoomDockByApiKey(meta.apiKeyId, msg.instance_id || 'default');
    }
  }

  const room = sqlite.getRoom(roomId);
  if (!room) {
    send(ws, { type: 'error', code: 'room_not_found', message: 'Room not found' });
    return;
  }
  if (accountId && room.account_id !== accountId) {
    send(ws, { type: 'error', code: 'room_forbidden', message: 'No access to this room' });
    return;
  }

  if (isControlClient(client)) {
    const owner = sqlite.getAccountById(room.account_id);
    const max = getMaxControlConnections(owner || { subscription_tier: 'starter' });
    if (countControlConnections(roomId) >= max) {
      send(ws, {
        type: 'error',
        code: 'control_connection_limit',
        message: `Control connection limit reached (${max} per table). Disconnect another device or upgrade your plan.`,
      });
      return;
    }
  }

  if (meta.client === 'dashboard' && meta.accountId) {
    removeAccountDashboard(meta.accountId, ws);
  }

  if (meta.roomId) {
    const old = getRoomClients(meta.roomId);
    removeRoomClientByWs(old, ws);
  }

  meta.roomId = roomId;
  meta.client = client;

  getRoomClients(roomId).add({
    ws,
    client,
    accountId: accountId || room.account_id,
    sourceId: meta.sourceId,
    guestToken: meta.guestToken || null,
    apiKeyId: meta.apiKeyId || null,
  });

  const { state, sessionId } = sqlite.getRoomSessionState(roomId);

  send(ws, {
    type: 'joined',
    room_id: roomId,
    client,
    clients: listClientTypes(roomId),
    session_id: sessionId,
    state,
    role: meta.role || null,
    permissions: permissionsForAuth({
      account: { id: accountId || room.account_id },
      authMethod: meta.authMethod || (meta.apiKeyId ? 'api_key' : (meta.guestToken ? 'guest' : 'jwt')),
      keyId: meta.apiKeyId || null,
      role: meta.role || null,
    }),
    ...(client === 'dock' && meta.apiKeyId ? { api_key_id: meta.apiKeyId } : {}),
    ...(meta.guestToken ? {
      is_dock_owner: !!meta.isDockOwnerGuest,
      guest_label: meta.guestLabel || null,
    } : {}),
  });

  broadcast(roomId, {
    type: 'presence',
    room_id: roomId,
    clients: listClientTypes(roomId),
  }, ws);

  if (client === 'dock') {
    sqlite.ensureDefaultDockOwnerGuestToken(roomId, accountId || room.account_id);
    cancelRoomCleanup(roomId);
    notifyAccountTables(accountId || room.account_id, { immediate: true });
  }
}

function requireJoined(ws, meta) {
  if (!meta.roomId) {
    send(ws, { type: 'error', code: 'not_joined', message: 'Send join first' });
    return false;
  }
  return true;
}

function persistEvent(meta, eventType, payload, sourceClient, sessionIdOverride) {
  const sessionId = sessionIdOverride !== undefined
    ? sessionIdOverride
    : sqlite.getRoomSessionState(meta.roomId).sessionId;
  let accountId = meta.accountId || null;
  if (!accountId && meta.roomId) {
    const room = sqlite.getRoom(meta.roomId);
    accountId = room?.account_id || null;
  }
  return sqlite.insertMatchEvent({
    accountId,
    roomId: meta.roomId,
    sessionId,
    eventType,
    payload,
    sourceClient: sourceClient || meta.client,
    apiKeyId: meta.apiKeyId || null,
  });
}

function handleEvent(ws, meta, msg) {
  if (!requireJoined(ws, meta)) return;
  const payload = msg.payload || {};
  const envelope = {
    type: 'event',
    room_id: meta.roomId,
    payload,
    source: msg.source || meta.client,
    source_id: meta.sourceId,
    ts: msg.ts || new Date().toISOString(),
  };
  persistEvent(meta, 'event', payload, envelope.source);
  broadcast(meta.roomId, envelope, ws);
}

/** Commands only the Cloud account owner (JWT/dev) may send. */
const ACCOUNT_OWNER_COMMANDS = new Set([
  'toggle_streaming',
  'set_replay_controls',
]);

function handleCommand(ws, meta, msg) {
  if (!requireJoined(ws, meta)) return;
  const isDockOwnerGuest = !!(meta.guestToken && meta.isDockOwnerGuest);
  if (meta.client === 'mobile_guest' && !isDockOwnerGuest && !GUEST_ALLOWED_COMMANDS.has(msg.action)) {
    send(ws, { type: 'error', code: 'guest_forbidden', message: 'Not available on guest scorer links' });
    return;
  }
  if (ACCOUNT_OWNER_COMMANDS.has(msg.action)) {
    const isOwner = meta.authMethod === 'jwt'
      || meta.authMethod === 'dev'
      || (meta.client === 'mobile' && !!meta.accountId && !meta.guestToken)
      || isDockOwnerGuest;
    if (!isOwner) {
      send(ws, {
        type: 'error',
        code: 'owner_forbidden',
        message: 'Only the account owner can use this control',
      });
      return;
    }
  }
  const envelope = {
    type: 'command',
    room_id: meta.roomId,
    action: msg.action,
    payload: msg.payload || {},
    source: msg.source || meta.client,
    source_id: meta.sourceId,
    ts: msg.ts || new Date().toISOString(),
  };
  persistEvent(meta, `command:${msg.action}`, envelope.payload, envelope.source);
  // Relay to other room members. Dock executes; mobile CloudClient ignores command messages.
  broadcast(meta.roomId, envelope, ws);
}

function handleState(ws, meta, msg) {
  if (!requireJoined(ws, meta)) return;
  const state = msg.state || {};
  sqlite.setRoomSessionState(meta.roomId, sqlite.getRoomSessionState(meta.roomId).sessionId, state);
  const listed = state.streamPromotionListed === true &&
    state.obsStreaming === true &&
    state.streamUrl;
  if (listed) {
    sqlite.upsertLiveStream(meta.roomId, state.streamUrl, state);
  } else {
    sqlite.deleteLiveStream(meta.roomId);
  }
  persistEvent(meta, 'state', state, meta.client);
  if (meta.accountId) {
    sqlite.upsertAccountPlayersFromState(meta.accountId, state);
  }
  const envelope = {
    type: 'state',
    room_id: meta.roomId,
    state,
    source: meta.client,
    ts: new Date().toISOString(),
  };
  broadcast(meta.roomId, envelope, ws);
  if (meta.accountId) {
    notifyAccountTables(meta.accountId);
  }
}

function handleSession(ws, meta, msg) {
  if (!requireJoined(ws, meta)) return;
  const action = msg.action;
  let sessionId = sqlite.getRoomSessionState(meta.roomId).sessionId;
  const payload = msg.payload || {};

  if (action === 'start') {
    sessionId = uuidv4();
    sqlite.setRoomSessionId(meta.roomId, sessionId);
    if (meta.accountId) {
      sqlite.upsertAccountPlayer(meta.accountId, payload.player1, payload.player1Id || null);
      sqlite.upsertAccountPlayer(meta.accountId, payload.player2, payload.player2Id || null);
    }
  } else if (action === 'discard') {
    // Clear Game / abandon: remove the open cloud match from history (not a completed end).
    const matchKey = payload.matchId || payload.sessionId || sessionId || null;
    const deleted = sqlite.discardRoomSessionEvents(meta.roomId, matchKey);
    sqlite.setRoomSessionId(meta.roomId, null);
    sessionId = null;
    broadcast(meta.roomId, {
      type: 'session',
      room_id: meta.roomId,
      action: 'discard',
      session_id: null,
      payload: Object.assign({}, payload, { deleted }),
      source: meta.client,
      ts: new Date().toISOString(),
    }, ws);
    if (meta.accountId) {
      notifyAccountTables(meta.accountId, { immediate: true });
    }
    return;
  }

  // Persist before clearing room session on end so the end row keeps session_id for pairing.
  persistEvent(meta, `session:${action}`, payload, meta.client, sessionId);
  if (action === 'end') {
    sqlite.setRoomSessionId(meta.roomId, null);
  }

  broadcast(meta.roomId, {
    type: 'session',
    room_id: meta.roomId,
    action,
    session_id: action === 'end' ? null : sessionId,
    payload,
    source: meta.client,
    ts: new Date().toISOString(),
  }, ws);

  if (meta.accountId && (action === 'start' || action === 'end')) {
    notifyAccountTables(meta.accountId, { immediate: true });
  }
}

/** Relay a command into a room (e.g. dashboard Kill → dock abandon_match). */
export function broadcastRoomCommand(roomId, action, payload = {}, source = 'dashboard') {
  if (!roomId || !action) return false;
  if (!rooms.has(roomId)) return false;
  const envelope = {
    type: 'command',
    room_id: roomId,
    action,
    payload: payload || {},
    source,
    source_id: null,
    ts: new Date().toISOString(),
  };
  broadcast(roomId, envelope);
  return true;
}

export function getConnectionCount() {
  return connections.size;
}

/** True when at least one dock WebSocket is joined to the room. */
export function roomHasConnectedDock(roomId) {
  if (!roomId) return false;
  for (const conn of getRoomClients(roomId)) {
    if (conn.client === 'dock' && conn.ws.readyState === 1) return true;
  }
  return false;
}

/**
 * Promoted streams from rooms that currently have a dock connected.
 * Authoritative while the dock is online (avoids idle TTL drops between score updates).
 */
export function getConnectedDockPromotedStreams() {
  const out = [];
  for (const [roomId, clients] of rooms.entries()) {
    let hasDock = false;
    for (const conn of clients) {
      if (conn.client === 'dock' && conn.ws.readyState === 1) {
        hasDock = true;
        break;
      }
    }
    if (!hasDock) continue;
    const { state } = sqlite.getRoomSessionState(roomId);
    const streamUrl = String(state?.streamUrl || '').trim();
    const listed = state?.streamPromotionListed === true
      && state?.obsStreaming === true
      && !!streamUrl;
    if (!listed) continue;
    const room = sqlite.getRoom(roomId);
    out.push({
      room_id: roomId,
      stream_url: streamUrl,
      state: state || {},
      room_label: room?.label || null,
      account_id: room?.account_id || null,
      updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      source: 'dock_presence',
    });
  }
  return out;
}

/** Live guest sockets keyed by guest token for a room. */
export function guestConnectionCounts(roomId) {
  const counts = {};
  if (!roomId) return counts;
  for (const conn of getRoomClients(roomId)) {
    if (conn.client !== 'mobile_guest' || !conn.guestToken) continue;
    if (conn.ws.readyState !== 1) continue;
    counts[conn.guestToken] = (counts[conn.guestToken] || 0) + 1;
  }
  return counts;
}

function kickConnections(match, payload) {
  const targets = [];
  for (const [ws, meta] of connections) {
    if (match(meta)) targets.push(ws);
  }
  for (const ws of targets) {
    send(ws, { type: 'error', ...payload });
    const target = ws;
    setTimeout(() => {
      try { target.close(); } catch (_) { /* ignore */ }
    }, 50);
  }
  return targets.length;
}

/** Close sockets using a revoked guest token. */
export function kickGuestToken(token) {
  if (!token) return 0;
  return kickConnections(
    (meta) => meta.guestToken === token,
    { code: 'guest_revoked', message: 'Guest link revoked' },
  );
}

/** Disconnect admin mobile and dashboard sockets (not dock or guests). */
export function kickAccountAdminClients(accountId) {
  if (!accountId) return 0;
  return kickConnections(
    (meta) => meta.accountId === accountId && (meta.client === 'mobile' || meta.client === 'dashboard'),
    { code: 'session_revoked', message: 'Signed out everywhere' },
  );
}

/** Disconnect all guest scorers for an account. */
export function kickAccountGuestClients(accountId) {
  if (!accountId) return 0;
  return kickConnections(
    (meta) => meta.accountId === accountId && meta.client === 'mobile_guest',
    { code: 'guest_revoked', message: 'Guest link revoked' },
  );
}

const API_KEY_REVOKED_MESSAGE =
  'This OBS Dock Key was revoked. Create a new key in the dashboard and paste it into Connection settings.';

/** Kick any live dock holding this API key (used on revoke). */
export function kickApiKeyDocks(keyId) {
  if (!keyId) return 0;
  const key = String(keyId);
  const targets = new Set();
  const indexed = docksByApiKeyId.get(key);
  if (indexed) {
    for (const ws of indexed) targets.add(ws);
  }
  for (const [ws, meta] of connections) {
    if (String(meta.apiKeyId || '') === key) targets.add(ws);
  }
  let n = 0;
  for (const ws of targets) {
    // Send first; brief delay so OBS/browser can process the error before close
    // (immediate close often drops the last frame and leaves the dock UI stuck).
    send(ws, { type: 'error', code: 'api_key_revoked', message: API_KEY_REVOKED_MESSAGE });
    const target = ws;
    setTimeout(() => {
      try { target.close(); } catch (_) { /* ignore */ }
    }, 50);
    n += 1;
  }
  docksByApiKeyId.delete(key);
  return n;
}

/**
 * Push an updated dock-key role to any live dock using that key
 * so Remote/Stats permissions refresh without reconnect.
 */
export function notifyApiKeyRoleChange(keyId, role) {
  if (!keyId) return 0;
  const key = String(keyId);
  const nextRole = role || null;
  const targets = new Set();
  const indexed = docksByApiKeyId.get(key);
  if (indexed) {
    for (const ws of indexed) targets.add(ws);
  }
  for (const [ws, meta] of connections) {
    if (String(meta.apiKeyId || '') === key) targets.add(ws);
  }
  let n = 0;
  for (const ws of targets) {
    const meta = connections.get(ws);
    if (!meta) continue;
    meta.role = nextRole;
    const permissions = permissionsForAuth({
      account: { id: meta.accountId },
      authMethod: meta.authMethod || 'api_key',
      keyId: meta.apiKeyId || key,
      role: nextRole,
    });
    send(ws, {
      type: 'role_updated',
      api_key_id: key,
      role: nextRole,
      permissions,
    });
    n += 1;
  }
  return n;
}

/** Kick every client currently joined to a room. */
export function kickRoomClients(roomId, payload = {
  code: 'room_deleted',
  message: 'This table was removed. Match history is kept on your account.',
}) {
  if (!roomId) return 0;
  return kickConnections(
    (meta) => meta.roomId === roomId,
    payload,
  );
}

export function cancelRoomCleanup(roomId) {
  if (!roomId) return;
  const timer = roomCleanupTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimers.delete(roomId);
  }
  roomCleanupAfter.delete(roomId);
}

export function scheduleRoomCleanup(roomId, graceMs = config.roomCleanupGraceMs) {
  if (!roomId) return;
  cancelRoomCleanup(roomId);
  const due = Date.now() + Math.max(0, graceMs);
  roomCleanupAfter.set(roomId, due);
  const room = sqlite.getRoom(roomId);
  if (room?.account_id) {
    notifyAccountTables(room.account_id, { immediate: true });
  }
  const timer = setTimeout(() => {
    roomCleanupTimers.delete(roomId);
    roomCleanupAfter.delete(roomId);
    if (roomHasConnectedDock(roomId)) return;
    performDeleteRoom(roomId);
  }, Math.max(0, graceMs));
  roomCleanupTimers.set(roomId, timer);
}

/**
 * Delete room + kick clients. Never deletes match_events (FK sets room_id NULL).
 * Returns { ok, accountId } for callers that need to refresh dashboards.
 */
export function performDeleteRoom(roomId) {
  if (!roomId) return { ok: false, accountId: null };
  const room = sqlite.getRoom(roomId);
  if (!room) {
    cancelRoomCleanup(roomId);
    return { ok: false, accountId: null };
  }
  const accountId = room.account_id;
  cancelRoomCleanup(roomId);
  roomsBeingDeleted.add(roomId);
  try {
    kickRoomClients(roomId);
    sqlite.deleteRoom(roomId);
    if (rooms.has(roomId)) {
      rooms.delete(roomId);
    }
  } finally {
    roomsBeingDeleted.delete(roomId);
  }
  if (accountId) {
    notifyAccountTables(accountId, { immediate: true });
  }
  return { ok: true, accountId };
}

function sqliteCutoffFromMsAgo(msAgo) {
  const d = new Date(Date.now() - msAgo);
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** Prune unmapped rooms, idle TTL rooms, and rooms whose grace already fired offline. */
export function sweepStaleRooms() {
  let deleted = 0;

  for (const room of sqlite.listUnmappedRooms()) {
    if (roomHasConnectedDock(room.id)) continue;
    if (performDeleteRoom(room.id).ok) deleted += 1;
  }

  if (config.roomIdleTtlMs > 0) {
    const cutoff = sqliteCutoffFromMsAgo(config.roomIdleTtlMs);
    for (const room of sqlite.listRoomsIdleBefore(cutoff)) {
      if (roomHasConnectedDock(room.id)) continue;
      if (performDeleteRoom(room.id).ok) deleted += 1;
    }
  }

  // Grace timers that were lost on restart: rooms with no dock and last_seen older than grace.
  if (config.roomCleanupGraceMs > 0) {
    const graceCutoff = sqliteCutoffFromMsAgo(config.roomCleanupGraceMs);
    for (const room of sqlite.listRoomsIdleBefore(graceCutoff)) {
      if (roomHasConnectedDock(room.id)) continue;
      if (roomCleanupTimers.has(room.id)) continue;
      if (performDeleteRoom(room.id).ok) deleted += 1;
    }
  }

  return deleted;
}

export function startRoomCleanupSweeper() {
  if (sweeperTimer) return;
  const interval = Math.max(5000, config.roomCleanupSweeperMs || 600000);
  sweeperTimer = setInterval(() => {
    try {
      sweepStaleRooms();
    } catch (err) {
      console.error('Room cleanup sweeper error:', err);
    }
  }, interval);
  if (typeof sweeperTimer.unref === 'function') sweeperTimer.unref();
  // Run once shortly after boot so orphan rooms clear in dev.
  setTimeout(() => {
    try { sweepStaleRooms(); } catch (_) { /* ignore */ }
  }, 2000).unref?.();
}

export function getRoomCleanupAfter(roomId) {
  return roomCleanupAfter.get(roomId) || null;
}
