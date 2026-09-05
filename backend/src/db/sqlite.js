import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT UNIQUE,
  email TEXT NOT NULL,
  stripe_customer_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'active',
  subscription_tier TEXT NOT NULL DEFAULT 'starter',
  sessions_invalid_after TEXT,
  session_epoch INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_plaintext TEXT,
  label TEXT NOT NULL DEFAULT 'Default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Default Room',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS match_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  session_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  source_client TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS live_streams (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  stream_url TEXT,
  state TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_sessions (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  session_id TEXT,
  state TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_docks (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instance_key TEXT NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Table',
  last_seen_at TEXT,
  PRIMARY KEY (account_id, instance_key)
);

CREATE TABLE IF NOT EXISTS room_guest_tokens (
  token TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Guest scorer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS account_players (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_rooms_account ON rooms(account_id);
CREATE INDEX IF NOT EXISTS idx_match_events_room ON match_events(room_id, created_at DESC);
`;

let db;

function tableColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function ensureAccountColumns(database) {
  const cols = new Set(tableColumns(database, 'accounts'));
  if (!cols.has('sessions_invalid_after')) {
    database.exec('ALTER TABLE accounts ADD COLUMN sessions_invalid_after TEXT');
  }
  if (!cols.has('session_epoch')) {
    database.exec('ALTER TABLE accounts ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 1');
  }
}

function ensureApiKeyColumns(database) {
  const cols = new Set(tableColumns(database, 'api_keys'));
  if (!cols.has('key_plaintext')) {
    database.exec('ALTER TABLE api_keys ADD COLUMN key_plaintext TEXT');
  }
}

export function getDb() {
  if (!db) {
    const dir = path.dirname(config.sqlitePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(config.sqlitePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    ensureAccountColumns(db);
    ensureApiKeyColumns(db);
  }
  return db;
}

export function generateApiKeyPlaintext() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hashApiKey(key) {
  return bcrypt.hashSync(key, 10);
}

export function verifyApiKey(key, hash) {
  return bcrypt.compareSync(key, hash);
}

/** Sync helper for default tier (avoid circular import with quotas.js). */
function defaultTierSync() {
  const raw = (process.env.TIER_DEFAULT || (config.allowDevAuth ? 'selfhost' : 'starter')).toLowerCase();
  return raw || 'starter';
}

/** Dev / self-host: ensure account + default room exist for email */
export function ensureAccountWithRoom(email, authUserId = null) {
  const database = getDb();
  let account = database.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
  if (!account) {
    const id = uuidv4();
    const tier = defaultTierSync();
    database.prepare(
      `INSERT INTO accounts (id, auth_user_id, email, subscription_tier) VALUES (?, ?, ?, ?)`
    ).run(id, authUserId, email, tier);
    account = database.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  } else if (authUserId && !account.auth_user_id) {
    database.prepare('UPDATE accounts SET auth_user_id = ? WHERE id = ?').run(authUserId, account.id);
    account = database.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id);
  }

  let room = database.prepare('SELECT * FROM rooms WHERE account_id = ? ORDER BY created_at LIMIT 1').get(account.id);
  if (!room) {
    const roomId = uuidv4();
    database.prepare('INSERT INTO rooms (id, account_id, label) VALUES (?, ?, ?)').run(roomId, account.id, 'Default Room');
    room = database.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  }
  return { account, room };
}

export function createApiKey(accountId, label = 'Default') {
  const database = getDb();
  const plaintext = generateApiKeyPlaintext();
  const id = uuidv4();
  database.prepare(
    `INSERT INTO api_keys (id, account_id, key_hash, key_plaintext, label) VALUES (?, ?, ?, ?, ?)`
  ).run(id, accountId, hashApiKey(plaintext), plaintext, label);
  return { id, plaintext };
}

export function findAccountByApiKey(plaintextKey) {
  const database = getDb();
  const keys = database.prepare(
    `SELECT ak.*, a.* FROM api_keys ak
     JOIN accounts a ON a.id = ak.account_id
     WHERE ak.revoked_at IS NULL`
  ).all();
  for (const row of keys) {
    if (verifyApiKey(plaintextKey, row.key_hash)) {
      return {
        account: {
          id: row.account_id,
          email: row.email,
          subscription_status: row.subscription_status,
          subscription_tier: row.subscription_tier,
          sessions_invalid_after: row.sessions_invalid_after,
          session_epoch: row.session_epoch,
        },
        keyId: row.id,
      };
    }
  }
  return null;
}

export function getRoom(roomId) {
  return getDb().prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
}

export function roomBelongsToAccount(roomId, accountId) {
  const room = getRoom(roomId);
  return room && room.account_id === accountId;
}

export function getAccountByAuthUserId(authUserId) {
  return getDb().prepare('SELECT * FROM accounts WHERE auth_user_id = ?').get(authUserId);
}

export function getAccountById(id) {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function getRoomsForAccount(accountId) {
  return getDb().prepare('SELECT * FROM rooms WHERE account_id = ? ORDER BY created_at').all(accountId);
}

export function getApiKeysForAccount(accountId) {
  return getDb().prepare(
    `SELECT id, label, created_at, revoked_at,
            CASE WHEN key_plaintext IS NOT NULL AND length(key_plaintext) > 0 THEN 1 ELSE 0 END AS viewable
     FROM api_keys WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at`
  ).all(accountId).map((row) => ({
    id: row.id,
    label: row.label,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    viewable: !!row.viewable,
  }));
}

/** Returns plaintext key for the account owner, or null if missing/revoked/legacy. */
export function getApiKeyPlaintext(keyId, accountId) {
  const row = getDb().prepare(
    `SELECT key_plaintext FROM api_keys
     WHERE id = ? AND account_id = ? AND revoked_at IS NULL`
  ).get(keyId, accountId);
  if (!row || !row.key_plaintext) {
    return null;
  }
  return row.key_plaintext;
}

export function countActiveApiKeys(accountId) {
  return getDb().prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ? AND revoked_at IS NULL`
  ).get(accountId)?.n || 0;
}

export function countRoomsForAccount(accountId) {
  return getDb().prepare(
    `SELECT COUNT(*) AS n FROM rooms WHERE account_id = ?`
  ).get(accountId)?.n || 0;
}

export function revokeApiKey(keyId, accountId) {
  const result = getDb().prepare(
    `UPDATE api_keys SET revoked_at = datetime('now')
     WHERE id = ? AND account_id = ? AND revoked_at IS NULL`
  ).run(keyId, accountId);
  return result.changes > 0;
}

export function listGuestTokensForAccount(accountId) {
  return getDb().prepare(
    `SELECT g.token, g.room_id, g.label, g.created_at, r.label AS room_label
     FROM room_guest_tokens g
     JOIN rooms r ON r.id = g.room_id
     WHERE g.account_id = ? AND g.revoked_at IS NULL
     ORDER BY g.created_at DESC`
  ).all(accountId);
}

export function listGuestTokensForRoom(roomId, accountId) {
  return getDb().prepare(
    `SELECT g.token, g.room_id, g.label, g.created_at, r.label AS room_label
     FROM room_guest_tokens g
     JOIN rooms r ON r.id = g.room_id
     WHERE g.account_id = ? AND g.room_id = ? AND g.revoked_at IS NULL
     ORDER BY g.created_at DESC`
  ).all(accountId, roomId);
}

export function invalidateAllSessions(accountId) {
  getDb().prepare(
    `UPDATE accounts
     SET sessions_invalid_after = datetime('now'),
         session_epoch = COALESCE(session_epoch, 1) + 1
     WHERE id = ?`
  ).run(accountId);
  return getAccountById(accountId);
}

export function insertMatchEvent({ roomId, sessionId, eventType, payload, sourceClient }) {
  const id = uuidv4();
  getDb().prepare(
    `INSERT INTO match_events (id, room_id, session_id, event_type, payload, source_client) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, roomId, sessionId || null, eventType, JSON.stringify(payload || {}), sourceClient || null);
  return id;
}

export function getMatchEvents(roomId, limit = 100) {
  return getDb().prepare(
    `SELECT * FROM match_events WHERE room_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(roomId, limit).map((row) => ({
    ...row,
    payload: JSON.parse(row.payload || '{}'),
  }));
}

/** Newest session start/end events across all rooms for an account (then reversed for pairing). */
export function getAccountSessionEvents(accountId, limit = 5000) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 10000);
  return getDb().prepare(
    `SELECT e.id, e.room_id, e.session_id, e.event_type, e.payload, e.created_at,
            r.label AS room_label,
            d.instance_key, d.label AS dock_label
     FROM match_events e
     JOIN rooms r ON r.id = e.room_id
     LEFT JOIN room_docks d ON d.room_id = e.room_id
     WHERE r.account_id = ?
       AND e.event_type IN ('session:start', 'session:end')
     ORDER BY e.created_at DESC
     LIMIT ?`
  ).all(accountId, cap).map((row) => ({
    ...row,
    payload: JSON.parse(row.payload || '{}'),
  }));
}

export function getMatchEventById(id) {
  if (!id) return null;
  const row = getDb().prepare('SELECT * FROM match_events WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload || '{}') };
}

export function updateMatchEvent(id, { payload, createdAt } = {}) {
  if (createdAt) {
    getDb().prepare(
      'UPDATE match_events SET payload = ?, created_at = ? WHERE id = ?'
    ).run(JSON.stringify(payload || {}), createdAt, id);
  } else {
    getDb().prepare(
      'UPDATE match_events SET payload = ? WHERE id = ?'
    ).run(JSON.stringify(payload || {}), id);
  }
}

export function deleteMatchEvents(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return 0;
  const stmt = getDb().prepare('DELETE FROM match_events WHERE id = ?');
  const tx = getDb().transaction((eventIds) => {
    let n = 0;
    for (const eventId of eventIds) {
      n += stmt.run(eventId).changes;
    }
    return n;
  });
  return tx(list);
}

/**
 * Delete session:start / session:end rows for a room that belong to one match/session key.
 * Used when Clear Game discards an in-progress cloud match (do not leave "active" history).
 */
export function discardRoomSessionEvents(roomId, matchKey) {
  if (!roomId) return 0;
  const key = matchKey ? String(matchKey) : '';
  const rows = getDb().prepare(
    `SELECT id, session_id, event_type, payload
     FROM match_events
     WHERE room_id = ?
       AND event_type IN ('session:start', 'session:end')
     ORDER BY created_at DESC
     LIMIT 200`
  ).all(roomId);

  const ids = [];
  for (const row of rows) {
    let payload = {};
    try {
      payload = JSON.parse(row.payload || '{}') || {};
    } catch (_) {
      payload = {};
    }
    const candidates = [
      row.session_id,
      payload.sessionId,
      payload.matchId,
    ].filter(Boolean).map(String);

    if (key) {
      if (candidates.includes(key)) ids.push(row.id);
      continue;
    }
  }

  // No key (or no payload match): drop the newest unpaired session:start for this room.
  if (!ids.length) {
    const starts = [];
    const ended = new Set();
    for (const row of rows) {
      let payload = {};
      try {
        payload = JSON.parse(row.payload || '{}') || {};
      } catch (_) {
        payload = {};
      }
      if (row.event_type === 'session:end') {
        const endKey = String(payload.matchId || payload.sessionId || row.session_id || '');
        if (endKey) ended.add(endKey);
        continue;
      }
      starts.push({ row, payload });
    }
    for (const { row, payload } of starts) {
      const startKey = String(payload.sessionId || payload.matchId || row.session_id || '');
      if (startKey && ended.has(startKey)) continue;
      ids.push(row.id);
      break;
    }
  }

  return deleteMatchEvents(ids);
}

export function upsertLiveStream(roomId, streamUrl, state) {
  getDb().prepare(
    `INSERT INTO live_streams (room_id, stream_url, state, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(room_id) DO UPDATE SET stream_url = excluded.stream_url, state = excluded.state, updated_at = datetime('now')`
  ).run(roomId, streamUrl || null, JSON.stringify(state || {}));
}

export function deleteLiveStream(roomId) {
  getDb().prepare('DELETE FROM live_streams WHERE room_id = ?').run(roomId);
}

export function getActiveLiveStreams(maxAgeMinutes = 30) {
  return getDb().prepare(
    `SELECT ls.*, r.label as room_label, r.account_id
     FROM live_streams ls
     JOIN rooms r ON r.id = ls.room_id
     WHERE datetime(ls.updated_at) > datetime('now', ?)
     ORDER BY ls.updated_at DESC`
  ).all(`-${maxAgeMinutes} minutes`).map((row) => {
    const state = JSON.parse(row.state || '{}');
    if (!state.streamPromotionListed) return null;
    return {
      ...row,
      state,
      stream_url: row.stream_url,
    };
  }).filter(Boolean);
}

export function getRoomSessionState(roomId) {
  const row = getDb().prepare('SELECT * FROM room_sessions WHERE room_id = ?').get(roomId);
  if (!row) return { sessionId: null, state: {} };
  return { sessionId: row.session_id, state: JSON.parse(row.state || '{}') };
}

export function setRoomSessionState(roomId, sessionId, state) {
  getDb().prepare(
    `INSERT INTO room_sessions (room_id, session_id, state, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(room_id) DO UPDATE SET session_id = excluded.session_id, state = excluded.state, updated_at = datetime('now')`
  ).run(roomId, sessionId || null, JSON.stringify(state || {}));
}

export function setRoomSessionId(roomId, sessionId) {
  const existing = getRoomSessionState(roomId);
  setRoomSessionState(roomId, sessionId, existing.state);
}

function defaultInstanceLabel(instanceKey) {
  if (!instanceKey || instanceKey === 'default') return 'Main table';
  return instanceKey.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One room per OBS instance key (URL ?instance=) under an account.
 *  Returns { room } for existing mapping, or creates a new room.
 *  Callers must enforce room quotas before create (see room-hub).
 *  Use peekRoomDock / createRoomForInstance when you need a pre-check.
 */
export function peekRoomDock(accountId, instanceKey) {
  const key = (instanceKey || 'default').trim() || 'default';
  return getDb().prepare(
    'SELECT * FROM room_docks WHERE account_id = ? AND instance_key = ?'
  ).get(accountId, key) || null;
}

export function ensureRoomForInstance(accountId, instanceKey, label) {
  const database = getDb();
  const key = (instanceKey || 'default').trim() || 'default';
  let row = peekRoomDock(accountId, key);
  if (row) {
    database.prepare(
      `UPDATE room_docks SET last_seen_at = datetime('now'), label = COALESCE(?, label) WHERE account_id = ? AND instance_key = ?`
    ).run(label || null, accountId, key);
    return getRoom(row.room_id);
  }
  const roomId = uuidv4();
  const roomLabel = label || defaultInstanceLabel(key);
  database.prepare('INSERT INTO rooms (id, account_id, label) VALUES (?, ?, ?)').run(roomId, accountId, roomLabel);
  database.prepare(
    `INSERT INTO room_docks (account_id, instance_key, room_id, label, last_seen_at) VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(accountId, key, roomId, roomLabel);
  return getRoom(roomId);
}

export function touchRoomDock(accountId, instanceKey) {
  const key = (instanceKey || 'default').trim() || 'default';
  getDb().prepare(
    `UPDATE room_docks SET last_seen_at = datetime('now') WHERE account_id = ? AND instance_key = ?`
  ).run(accountId, key);
}

export function getRoomsWithLiveState(accountId) {
  const rooms = getRoomsForAccount(accountId);
  return rooms.map((room) => {
    const dock = getDb().prepare('SELECT * FROM room_docks WHERE room_id = ?').get(room.id);
    const session = getRoomSessionState(room.id);
    const clients = [];
    return {
      ...room,
      instance_key: dock?.instance_key || null,
      dock_label: dock?.label || room.label,
      last_seen_at: dock?.last_seen_at || null,
      live_state: session.state || {},
      updated_at: getDb().prepare('SELECT updated_at FROM room_sessions WHERE room_id = ?').get(room.id)?.updated_at || null,
    };
  });
}

export function createGuestToken(roomId, accountId, label = 'Guest scorer') {
  const token = generateApiKeyPlaintext() + generateApiKeyPlaintext();
  getDb().prepare(
    `INSERT INTO room_guest_tokens (token, room_id, account_id, label) VALUES (?, ?, ?, ?)`
  ).run(token, roomId, accountId, label);
  return token;
}

export function findGuestToken(token) {
  if (!token) return null;
  return getDb().prepare(
    `SELECT * FROM room_guest_tokens WHERE token = ? AND revoked_at IS NULL`
  ).get(token);
}

export function revokeGuestToken(token, accountId) {
  getDb().prepare(
    `UPDATE room_guest_tokens SET revoked_at = datetime('now') WHERE token = ? AND account_id = ?`
  ).run(token, accountId);
}

export function revokeAllGuestTokens(accountId) {
  const result = getDb().prepare(
    `UPDATE room_guest_tokens SET revoked_at = datetime('now')
     WHERE account_id = ? AND revoked_at IS NULL`
  ).run(accountId);
  return result.changes;
}

function normalizePlayerName(name) {
  return String(name || '').trim().toLowerCase();
}

function truncatePlayerName(name) {
  return String(name || '').trim().slice(0, 20);
}

/** Remember a player name for account roster / mobile autocomplete. */
export function upsertAccountPlayer(accountId, name) {
  if (!accountId) return;
  const display = truncatePlayerName(name);
  const normalized = normalizePlayerName(display);
  if (!normalized) return;
  getDb().prepare(
    `INSERT INTO account_players (account_id, name, name_normalized, last_seen_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(account_id, name_normalized) DO UPDATE SET
       name = excluded.name,
       last_seen_at = datetime('now')`
  ).run(accountId, display, normalized);
}

export function upsertAccountPlayersFromState(accountId, state) {
  if (!accountId || !state || typeof state !== 'object') return;
  if (state.player1Name) upsertAccountPlayer(accountId, state.player1Name);
  if (state.player2Name) upsertAccountPlayer(accountId, state.player2Name);
}

/** Seed roster from saved room session state when table is still empty. */
export function seedAccountPlayersFromSessions(accountId) {
  const count = getDb().prepare(
    'SELECT COUNT(*) AS n FROM account_players WHERE account_id = ?'
  ).get(accountId)?.n || 0;
  if (count > 0) return;
  for (const room of getRoomsForAccount(accountId)) {
    const { state } = getRoomSessionState(room.id);
    upsertAccountPlayersFromState(accountId, state);
  }
}

export function searchAccountPlayers(accountId, query, limit = 8) {
  seedAccountPlayersFromSessions(accountId);
  syncAccountPlayersFromMatchEvents(accountId);
  const max = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 250);
  const normalized = normalizePlayerName(query);
  if (!normalized) {
    return getDb().prepare(
      `SELECT name, last_seen_at FROM account_players
       WHERE account_id = ?
       ORDER BY last_seen_at DESC, name COLLATE NOCASE ASC
       LIMIT ?`
    ).all(accountId, max);
  }
  const like = `%${normalized}%`;
  return getDb().prepare(
    `SELECT name, last_seen_at FROM account_players
     WHERE account_id = ? AND (name_normalized LIKE ? OR LOWER(name) LIKE ?)
     ORDER BY
       CASE WHEN name_normalized = ? THEN 0 WHEN name_normalized LIKE ? THEN 1 ELSE 2 END,
       last_seen_at DESC,
       name COLLATE NOCASE ASC
     LIMIT ?`
  ).all(accountId, like, like, normalized, `${normalized}%`, max);
}

/** Pull player names from recorded session:start events into the roster. */
export function syncAccountPlayersFromMatchEvents(accountId) {
  if (!accountId) return;
  const rows = getDb().prepare(
    `SELECT e.payload
     FROM match_events e
     JOIN rooms r ON r.id = e.room_id
     WHERE r.account_id = ?
       AND e.event_type = 'session:start'`
  ).all(accountId);
  for (const row of rows) {
    let payload = {};
    try {
      payload = JSON.parse(row.payload || '{}');
    } catch {
      payload = {};
    }
    if (payload.player1) upsertAccountPlayer(accountId, payload.player1);
    if (payload.player2) upsertAccountPlayer(accountId, payload.player2);
  }
}

/** Rename a roster entry (and drop the old key). Match event payloads are updated separately. */
export function renameAccountPlayerRoster(accountId, fromName, toName) {
  if (!accountId) return;
  const fromNorm = normalizePlayerName(fromName);
  const toDisplay = truncatePlayerName(toName);
  const toNorm = normalizePlayerName(toDisplay);
  if (!fromNorm || !toNorm) return;
  getDb().prepare(
    'DELETE FROM account_players WHERE account_id = ? AND name_normalized = ?'
  ).run(accountId, fromNorm);
  upsertAccountPlayer(accountId, toDisplay);
}
