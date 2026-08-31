import { v4 as uuidv4 } from 'uuid';
import * as sqlite from '../db/sqlite.js';

/** roomId -> Set<{ ws, client, accountId, sourceId }> */
const rooms = new Map();

/** ws -> connection meta */
const connections = new Map();

function getRoomClients(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  return rooms.get(roomId);
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

export function handleConnection(ws) {
  const sourceId = uuidv4();
  connections.set(ws, { roomId: null, client: null, accountId: null, sourceId });

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
    if (meta?.roomId) {
      const clients = getRoomClients(meta.roomId);
      for (const c of clients) {
        if (c.ws === ws) clients.delete(c);
      }
      broadcast(meta.roomId, {
        type: 'presence',
        room_id: meta.roomId,
        clients: listClientTypes(meta.roomId),
      });
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
    case 'disconnect':
      return ws.close();
    // Legacy compat shim for old stream_sharing clients
    case 'auth':
      return handleLegacyAuth(ws, meta, msg, authenticateJoin);
    case 'update':
      return handleLegacyUpdate(ws, meta, msg);
    default:
      send(ws, { type: 'error', code: 'unknown_type', message: `Unknown message type: ${msg.type}` });
  }
}

/** Commands allowed for guest scorer links (no names, setup, match, or replay). */
const GUEST_ALLOWED_COMMANDS = new Set([
  'score_add', 'score_sub', 'balls_add', 'balls_sub',
  'player_slot', 'select_breaker', 'toggle_pot', 'snooker_ball', 'snooker_foul', 'undo',
  'set_race', 'set_game_info',
]);

function resolveRoomIdForJoin(msg, auth, client) {
  let roomId = msg.room_id || msg.room || null;
  if (client === 'dock' && auth?.account && msg.instance_id) {
    const room = sqlite.ensureRoomForInstance(
      auth.account.id,
      msg.instance_id,
      msg.instance_label || null
    );
    roomId = room.id;
  }
  if (!roomId && client === 'dock' && auth?.account) {
    const rooms = sqlite.getRoomsForAccount(auth.account.id);
    if (rooms.length) roomId = rooms[0].id;
  }
  return roomId;
}

async function handleJoin(ws, meta, msg, authenticateJoin) {
  let client = msg.client || 'dock';
  let roomId = msg.room_id || msg.room;
  let accountId = null;

  if (msg.guest_token) {
    const guest = sqlite.findGuestToken(msg.guest_token);
    if (!guest) {
      send(ws, { type: 'error', code: 'invalid_guest_token', message: 'Invalid or expired guest link' });
      return;
    }
    roomId = guest.room_id;
    accountId = guest.account_id;
    client = 'mobile_guest';
    meta.client = client;
    meta.accountId = accountId;
    meta.guestToken = msg.guest_token;
  } else {
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

    roomId = resolveRoomIdForJoin(msg, auth, client);
    if (!roomId) {
      send(ws, { type: 'error', code: 'room_required', message: 'room_id is required' });
      return;
    }

    accountId = auth.account.id;
    meta.accountId = accountId;

    if (client === 'dock' && msg.instance_id) {
      sqlite.touchRoomDock(accountId, msg.instance_id);
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

  if (meta.roomId) {
    const old = getRoomClients(meta.roomId);
    for (const c of old) {
      if (c.ws === ws) old.delete(c);
    }
  }

  meta.roomId = roomId;
  meta.client = client;

  getRoomClients(roomId).add({
    ws,
    client,
    accountId: accountId || room.account_id,
    sourceId: meta.sourceId,
  });

  const { state, sessionId } = sqlite.getRoomSessionState(roomId);

  send(ws, {
    type: 'joined',
    room_id: roomId,
    client,
    clients: listClientTypes(roomId),
    session_id: sessionId,
    state,
  });

  broadcast(roomId, {
    type: 'presence',
    room_id: roomId,
    clients: listClientTypes(roomId),
  }, ws);
}

function requireJoined(ws, meta) {
  if (!meta.roomId) {
    send(ws, { type: 'error', code: 'not_joined', message: 'Send join first' });
    return false;
  }
  return true;
}

function persistEvent(meta, eventType, payload, sourceClient) {
  const { sessionId } = sqlite.getRoomSessionState(meta.roomId);
  return sqlite.insertMatchEvent({
    roomId: meta.roomId,
    sessionId,
    eventType,
    payload,
    sourceClient: sourceClient || meta.client,
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

function handleCommand(ws, meta, msg) {
  if (!requireJoined(ws, meta)) return;
  if (meta.client === 'mobile_guest' && !GUEST_ALLOWED_COMMANDS.has(msg.action)) {
    send(ws, { type: 'error', code: 'guest_forbidden', message: 'Not available on guest scorer links' });
    return;
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
  const envelope = {
    type: 'state',
    room_id: meta.roomId,
    state,
    source: meta.client,
    ts: new Date().toISOString(),
  };
  broadcast(meta.roomId, envelope, ws);
}

function handleSession(ws, meta, msg) {
  if (!requireJoined(ws, meta)) return;
  const action = msg.action;
  let sessionId = sqlite.getRoomSessionState(meta.roomId).sessionId;

  if (action === 'start') {
    sessionId = uuidv4();
    sqlite.setRoomSessionId(meta.roomId, sessionId);
  } else if (action === 'end') {
    sqlite.setRoomSessionId(meta.roomId, null);
  }

  persistEvent(meta, `session:${action}`, msg.payload || {}, meta.client);

  broadcast(meta.roomId, {
    type: 'session',
    room_id: meta.roomId,
    action,
    session_id: sessionId,
    payload: msg.payload || {},
    source: meta.client,
    ts: new Date().toISOString(),
  }, ws);
}

async function handleLegacyAuth(ws, meta, msg, authenticateJoin) {
  if (!msg.api_key) {
    send(ws, { type: 'auth', status: 'error', message: 'api_key required' });
    return;
  }
  const auth = await authenticateJoin({ apiKey: msg.api_key, client: 'dock' });
  if (auth.error) {
    send(ws, { type: 'auth', status: auth.error === 'invalid_api_key' ? 'blocked' : 'error', message: auth.message });
    return;
  }
  const accountRooms = sqlite.getRoomsForAccount(auth.account.id);
  if (accountRooms.length === 0) {
    send(ws, { type: 'auth', status: 'error', message: 'No room configured' });
    return;
  }
  meta.legacyRoomId = accountRooms[0].id;
  meta.accountId = auth.account.id;
  meta.client = 'dock';
  meta.roomId = meta.legacyRoomId;
  getRoomClients(meta.legacyRoomId).add({ ws, client: 'dock', accountId: auth.account.id, sourceId: meta.sourceId });
  send(ws, { type: 'auth', status: 'success' });
}

function handleLegacyUpdate(ws, meta, msg) {
  if (!msg.api_key || !meta.legacyRoomId) {
    send(ws, { type: 'ack', status: 'error', message: 'Not authenticated' });
    return;
  }
  const state = msg.state || {};
  sqlite.setRoomSessionState(meta.legacyRoomId, sqlite.getRoomSessionState(meta.legacyRoomId).sessionId, state);
  if (state.streamUrl) {
    sqlite.upsertLiveStream(meta.legacyRoomId, state.streamUrl, state);
  }
  send(ws, { type: 'ack', status: 'ok' });
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
