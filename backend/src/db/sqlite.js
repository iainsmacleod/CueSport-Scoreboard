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
  subscription_tier TEXT NOT NULL DEFAULT 'pro',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_rooms_account ON rooms(account_id);
CREATE INDEX IF NOT EXISTS idx_match_events_room ON match_events(room_id, created_at DESC);
`;

let db;

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

/** Dev / self-host: ensure account + default room exist for email */
export function ensureAccountWithRoom(email, authUserId = null) {
  const database = getDb();
  let account = database.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
  if (!account) {
    const id = uuidv4();
    database.prepare(
      `INSERT INTO accounts (id, auth_user_id, email) VALUES (?, ?, ?)`
    ).run(id, authUserId, email);
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
    `INSERT INTO api_keys (id, account_id, key_hash, label) VALUES (?, ?, ?, ?)`
  ).run(id, accountId, hashApiKey(plaintext), label);
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
    `SELECT id, label, created_at, revoked_at FROM api_keys WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at`
  ).all(accountId);
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

/** One room per OBS instance key (URL ?instance=) under an account. */
export function ensureRoomForInstance(accountId, instanceKey, label) {
  const database = getDb();
  const key = (instanceKey || 'default').trim() || 'default';
  let row = database.prepare(
    'SELECT * FROM room_docks WHERE account_id = ? AND instance_key = ?'
  ).get(accountId, key);
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
