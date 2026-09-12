import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import {
  normalizePlayerNameKey,
  truncatePlayerName,
} from '../lib/scoreboard-helpers.js';
import {
  DEFAULT_DOCK_KEY_ROLE,
  OBS_DOCK_OWNER_GUEST_LABEL,
  normalizeDockKeyRole,
} from '../lib/dock-roles.js';

function normalizePlayerName(name) {
  return normalizePlayerNameKey(name);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT UNIQUE,
  email TEXT NOT NULL,
  stripe_customer_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'active',
  subscription_tier TEXT NOT NULL DEFAULT 'starter',
  trial_ends_at TEXT,
  sessions_invalid_after TEXT,
  session_epoch INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_plaintext TEXT,
  label TEXT NOT NULL DEFAULT 'OBS Dock Key 1',
  role TEXT NOT NULL DEFAULT 'trusted_operator',
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
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  source_client TEXT,
  api_key_id TEXT,
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
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  api_key_id TEXT NOT NULL UNIQUE,
  instance_key TEXT NOT NULL DEFAULT 'default',
  label TEXT NOT NULL DEFAULT 'Table',
  last_seen_at TEXT
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
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_rooms_account ON rooms(account_id);
CREATE INDEX IF NOT EXISTS idx_account_players_account ON account_players(account_id);
CREATE INDEX IF NOT EXISTS idx_account_players_name ON account_players(account_id, name_normalized);
CREATE INDEX IF NOT EXISTS idx_room_docks_account ON room_docks(account_id);
CREATE INDEX IF NOT EXISTS idx_room_docks_api_key ON room_docks(api_key_id);
`;

const MATCH_EVENTS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_match_events_account ON match_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_events_room ON match_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_events_api_key ON match_events(api_key_id);
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
  if (!cols.has('trial_ends_at')) {
    database.exec('ALTER TABLE accounts ADD COLUMN trial_ends_at TEXT');
  }
}

function ensureApiKeyColumns(database) {
  const cols = new Set(tableColumns(database, 'api_keys'));
  if (!cols.has('key_plaintext')) {
    database.exec('ALTER TABLE api_keys ADD COLUMN key_plaintext TEXT');
  }
  if (!cols.has('role')) {
    database.exec(`ALTER TABLE api_keys ADD COLUMN role TEXT NOT NULL DEFAULT '${DEFAULT_DOCK_KEY_ROLE}'`);
  }
  // Legacy signup keys were labeled "Default" — rename to the numbered scheme.
  database.prepare(
    `UPDATE api_keys SET label = 'OBS Dock Key 1'
     WHERE lower(trim(label)) = 'default'`
  ).run();
}

function ensureMatchEventColumns(database) {
  const exists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_events'"
  ).get();
  if (!exists) return;
  const cols = new Set(tableColumns(database, 'match_events'));
  if (!cols.has('api_key_id')) {
    database.exec('ALTER TABLE match_events ADD COLUMN api_key_id TEXT');
  }
}

function ensureRoomDockColumns(database) {
  const exists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='room_docks'"
  ).get();
  if (!exists) return;

  const pkCols = database.prepare('PRAGMA table_info(room_docks)').all()
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);
  const keyPrimary = pkCols.length === 1 && pkCols[0] === 'room_id';
  if (!keyPrimary) {
    // Dev only: drop legacy instance-keyed table; wipe local DB if you need clean docks.
    console.warn('[sqlite] Dropping legacy room_docks (instance-keyed) — recreating Dock Key schema.');
    database.exec('DROP TABLE IF EXISTS room_docks');
    database.exec(`
      CREATE TABLE room_docks (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        api_key_id TEXT NOT NULL UNIQUE,
        instance_key TEXT NOT NULL DEFAULT 'default',
        label TEXT NOT NULL DEFAULT 'Table',
        last_seen_at TEXT
      );
    `);
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_room_docks_account ON room_docks(account_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_room_docks_api_key ON room_docks(api_key_id)');
}

/** Drop legacy room-owned match_events (no backfill — local/test wipe). */
function ensureMatchEventsAccountScoped(database) {
  const exists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_events'"
  ).get();
  if (!exists) return;
  const cols = new Set(tableColumns(database, 'match_events'));
  if (cols.has('account_id')) return;

  console.warn(
    '[sqlite] Legacy match_events (no account_id) — dropping and recreating account-scoped table. ' +
      'Match history is cleared; accounts/rooms/keys are kept.'
  );
  database.exec('DROP TABLE IF EXISTS match_events');
  database.exec(`
    CREATE TABLE match_events (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
      session_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      source_client TEXT,
      api_key_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_match_events_account ON match_events(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_match_events_room ON match_events(room_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_match_events_api_key ON match_events(api_key_id);
  `);
}

/** Dev wipe: name-keyed roster → UUID player rows (duplicate display names allowed). */
function ensureAccountPlayersUuid(database) {
  const exists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_players'"
  ).get();
  if (!exists) return;
  const cols = new Set(tableColumns(database, 'account_players'));
  if (cols.has('id')) return;

  console.warn(
    '[sqlite] Legacy account_players (name key) — dropping and recreating UUID-keyed table. ' +
      'Roster cleared; match_events kept (re-sync on next stats load).'
  );
  database.exec('DROP TABLE IF EXISTS account_players');
  database.exec(`
    CREATE TABLE account_players (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_account_players_account ON account_players(account_id);
    CREATE INDEX IF NOT EXISTS idx_account_players_name ON account_players(account_id, name_normalized);
  `);
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
    ensureRoomDockColumns(db);
    ensureMatchEventsAccountScoped(db);
    ensureMatchEventColumns(db);
    ensureAccountPlayersUuid(db);
    db.exec(MATCH_EVENTS_INDEXES);
  }
  return db;
}

export function generateApiKeyPlaintext() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createApiKey(accountId, label, role) {
  const database = getDb();
  const plaintext = generateApiKeyPlaintext();
  const id = uuidv4();
  const resolvedLabel = String(label || '').trim().slice(0, 40);
  if (!resolvedLabel) {
    return null;
  }
  const resolvedRole = normalizeDockKeyRole(role);
  database.prepare(
    `INSERT INTO api_keys (id, account_id, key_hash, key_plaintext, label, role)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, accountId, hashApiKey(plaintext), plaintext, resolvedLabel, resolvedRole);
  return { id, plaintext, label: resolvedLabel, role: resolvedRole };
}

export function getApiKeyById(keyId) {
  if (!keyId) return null;
  return getDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(keyId) || null;
}

export function connectionLabelForApiKey(apiKeyId) {
  const key = getApiKeyById(apiKeyId);
  // Connection title is the seat name itself (OBS Dock Key N).
  return key?.label || null;
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

/** Dev / self-host / OAuth: ensure account exists (no default room — rooms are created on dock join). */
export function ensureAccount(email, authUserId = null) {
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
  return { account, room: null };
}

/** Rooms with no room_docks mapping (junk from legacy signup / disabled POST). */
export function listUnmappedRooms() {
  return getDb().prepare(`
    SELECT r.* FROM rooms r
    WHERE NOT EXISTS (SELECT 1 FROM room_docks d WHERE d.room_id = r.id)
    ORDER BY r.created_at ASC
  `).all();
}

/**
 * Rooms eligible for idle TTL prune: mapped, last_seen older than cutoff ISO/SQLite datetime.
 * cutoffSqlite: e.g. datetime('now', '-14 days') equivalent — pass precomputed UTC string.
 */
export function listRoomsIdleBefore(cutoffSqlite) {
  return getDb().prepare(`
    SELECT r.*, d.instance_key, d.last_seen_at, d.label AS dock_label
    FROM rooms r
    JOIN room_docks d ON d.room_id = r.id
    WHERE d.last_seen_at IS NOT NULL AND d.last_seen_at < ?
    ORDER BY d.last_seen_at ASC
  `).all(cutoffSqlite);
}

/**
 * Delete a room row. Cascades room_docks / sessions / live_streams / guest tokens.
 * match_events.room_id becomes NULL — history is kept.
 */
export function deleteRoom(roomId) {
  if (!roomId) return false;
  const room = getRoom(roomId);
  if (!room) return false;
  const result = getDb().prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  return result.changes > 0;
}

export function countActiveGuestTokensForRoom(roomId) {
  return getDb().prepare(
    `SELECT COUNT(*) AS n FROM room_guest_tokens WHERE room_id = ? AND revoked_at IS NULL`
  ).get(roomId)?.n || 0;
}

export function findAccountByApiKey(plaintextKey) {
  const database = getDb();
  // Select ak.id explicitly — `ak.*, a.*` would let accounts.id overwrite api_keys.id.
  const keys = database.prepare(
    `SELECT ak.id AS key_id, ak.key_hash, ak.account_id, ak.role,
            a.email, a.subscription_status, a.subscription_tier,
            a.trial_ends_at, a.sessions_invalid_after, a.session_epoch
     FROM api_keys ak
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
          trial_ends_at: row.trial_ends_at || null,
          sessions_invalid_after: row.sessions_invalid_after,
          session_epoch: row.session_epoch,
        },
        keyId: row.key_id,
        role: normalizeDockKeyRole(row.role),
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
    `SELECT id, label, role, created_at, revoked_at,
            CASE WHEN key_plaintext IS NOT NULL AND length(key_plaintext) > 0 THEN 1 ELSE 0 END AS viewable
     FROM api_keys WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at`
  ).all(accountId).map((row) => ({
    id: row.id,
    label: row.label,
    role: normalizeDockKeyRole(row.role),
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    viewable: !!row.viewable,
  }));
}

/** Rename and/or change role of an active seat. */
export function updateApiKey(keyId, accountId, { label, role } = {}) {
  const database = getDb();
  const existing = database.prepare(
    `SELECT id, label, role FROM api_keys
     WHERE id = ? AND account_id = ? AND revoked_at IS NULL`
  ).get(keyId, accountId);
  if (!existing) return null;
  let nextLabel = existing.label;
  if (label != null) {
    nextLabel = String(label || '').trim().slice(0, 40);
    if (!nextLabel) return null;
  }
  const nextRole = role != null ? normalizeDockKeyRole(role) : normalizeDockKeyRole(existing.role);
  database.prepare(
    `UPDATE api_keys SET label = ?, role = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL`
  ).run(nextLabel, nextRole, keyId, accountId);
  if (nextLabel !== existing.label) {
    const docks = database.prepare(
      `SELECT room_id FROM room_docks WHERE api_key_id = ? AND account_id = ?`
    ).all(keyId, accountId);
    for (const dock of docks) {
      database.prepare(
        `UPDATE room_docks SET label = ? WHERE room_id = ? AND account_id = ?`
      ).run(nextLabel, dock.room_id, accountId);
      database.prepare('UPDATE rooms SET label = ? WHERE id = ? AND account_id = ?')
        .run(nextLabel, dock.room_id, accountId);
    }
  }
  return {
    id: keyId,
    label: nextLabel,
    role: nextRole,
    previous_label: existing.label,
    previous_role: normalizeDockKeyRole(existing.role),
  };
}

/** Rename an active seat; syncs room / dock labels that use this key. */
export function renameApiKey(keyId, accountId, label) {
  return updateApiKey(keyId, accountId, { label });
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

const ADMIN_ACCOUNT_SELECT = `
  SELECT a.id, a.email, a.created_at, a.subscription_status, a.subscription_tier,
         a.trial_ends_at, a.stripe_customer_id, a.session_epoch, a.sessions_invalid_after,
         (SELECT COUNT(*) FROM api_keys ak WHERE ak.account_id = a.id AND ak.revoked_at IS NULL) AS api_key_count,
         (SELECT COUNT(*) FROM rooms r WHERE r.account_id = a.id) AS room_count,
         (SELECT COUNT(*) FROM room_guest_tokens g WHERE g.account_id = a.id AND g.revoked_at IS NULL) AS guest_link_count,
         (SELECT MAX(d.last_seen_at) FROM room_docks d WHERE d.account_id = a.id) AS last_dock_seen_at
  FROM accounts a
`;

export function listAccountsForAdmin({ q = '', limit = 100 } = {}) {
  const database = getDb();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const needle = String(q || '').trim().toLowerCase();
  const rows = needle
    ? database.prepare(
      `${ADMIN_ACCOUNT_SELECT}
       WHERE lower(a.email) LIKE ?
       ORDER BY a.created_at DESC
       LIMIT ?`
    ).all(`%${needle}%`, cap)
    : database.prepare(
      `${ADMIN_ACCOUNT_SELECT}
       ORDER BY a.created_at DESC
       LIMIT ?`
    ).all(cap);
  return rows.map(mapAdminAccountRow);
}

function mapAdminAccountRow(row) {
  return {
    id: row.id,
    email: row.email,
    created_at: row.created_at,
    subscription_status: row.subscription_status,
    subscription_tier: row.subscription_tier,
    trial_ends_at: row.trial_ends_at || null,
    stripe_customer_id: row.stripe_customer_id || null,
    session_epoch: row.session_epoch,
    sessions_invalid_after: row.sessions_invalid_after || null,
    api_key_count: Number(row.api_key_count) || 0,
    room_count: Number(row.room_count) || 0,
    guest_link_count: Number(row.guest_link_count) || 0,
    last_activity_at: row.last_dock_seen_at || null,
  };
}

export function getAccountAdminDetail(accountId) {
  const database = getDb();
  const row = database.prepare(
    `${ADMIN_ACCOUNT_SELECT} WHERE a.id = ?`
  ).get(accountId);
  if (!row) return null;
  const account = mapAdminAccountRow(row);
  const rooms = database.prepare(
    `SELECT r.id, r.label, r.created_at,
            d.api_key_id, d.label AS dock_label, d.last_seen_at,
            (SELECT COUNT(*) FROM room_guest_tokens g
             WHERE g.room_id = r.id AND g.revoked_at IS NULL) AS guest_link_count
     FROM rooms r
     LEFT JOIN room_docks d ON d.room_id = r.id
     WHERE r.account_id = ?
     ORDER BY r.created_at`
  ).all(accountId).map((r) => ({
    id: r.id,
    label: r.label,
    created_at: r.created_at,
    api_key_id: r.api_key_id || null,
    dock_label: r.dock_label || null,
    last_seen_at: r.last_seen_at || null,
    guest_link_count: Number(r.guest_link_count) || 0,
  }));
  const apiKeys = getApiKeysForAccount(accountId);
  return {
    ...account,
    rooms,
    api_keys: apiKeys,
  };
}

/** Set or clear admin support trial end time (ISO / SQLite datetime string, or null). */
export function setAccountTrialEndsAt(accountId, trialEndsAt) {
  const existing = getAccountById(accountId);
  if (!existing) return null;
  getDb().prepare(
    `UPDATE accounts SET trial_ends_at = ? WHERE id = ?`
  ).run(trialEndsAt || null, accountId);
  return getAccountById(accountId);
}

export function insertMatchEvent({ accountId, roomId, sessionId, eventType, payload, sourceClient, apiKeyId }) {
  if (!accountId) {
    throw new Error('accountId is required to insert match events');
  }
  const id = uuidv4();
  getDb().prepare(
    `INSERT INTO match_events (id, account_id, room_id, session_id, event_type, payload, source_client, api_key_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    accountId,
    roomId || null,
    sessionId || null,
    eventType,
    JSON.stringify(payload || {}),
    sourceClient || null,
    apiKeyId || null
  );
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

/** Newest session start/end events for an account (then reversed for pairing). */
export function getAccountSessionEvents(accountId, limit = 5000) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 10000);
  return getDb().prepare(
    `SELECT e.id, e.account_id, e.room_id, e.session_id, e.event_type, e.payload, e.created_at,
            e.api_key_id,
            r.label AS room_label,
            d.instance_key, d.label AS dock_label
     FROM match_events e
     LEFT JOIN rooms r ON r.id = e.room_id
     LEFT JOIN room_docks d ON d.room_id = e.room_id
     WHERE e.account_id = ?
       AND e.event_type IN ('session:start', 'session:end')
     ORDER BY e.created_at DESC, e.rowid DESC
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
 *
 * When matchKey is provided: delete only events that match that key (never fall back).
 * When matchKey is omitted: delete the newest unpaired session:start for this room.
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

  function payloadOf(row) {
    try {
      return JSON.parse(row.payload || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function rowKeys(row) {
    const payload = payloadOf(row);
    return [
      row.session_id,
      payload.sessionId,
      payload.matchId,
    ].filter(Boolean).map(String);
  }

  // Explicit key: only delete matching rows. A miss deletes nothing.
  if (key) {
    const ids = [];
    for (const row of rows) {
      if (rowKeys(row).includes(key)) ids.push(row.id);
    }
    return deleteMatchEvents(ids);
  }

  // No key: drop the newest unpaired session:start for this room.
  const ended = new Set();
  const starts = [];
  for (const row of rows) {
    const payload = payloadOf(row);
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
    return deleteMatchEvents([row.id]);
  }

  return 0;
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

/** One room per OBS Dock Key (api_key_id). instance_key is last-seen metadata only. */
export function peekRoomDockByApiKey(apiKeyId) {
  if (!apiKeyId) return null;
  return getDb().prepare(
    'SELECT * FROM room_docks WHERE api_key_id = ?'
  ).get(apiKeyId) || null;
}

/** @deprecated Prefer peekRoomDockByApiKey — instance is no longer room identity. */
export function peekRoomDock(accountId, instanceKey) {
  const key = (instanceKey || 'default').trim() || 'default';
  return getDb().prepare(
    'SELECT * FROM room_docks WHERE account_id = ? AND instance_key = ? ORDER BY last_seen_at DESC LIMIT 1'
  ).get(accountId, key) || null;
}

/**
 * One room per Dock Key under an account.
 * Callers must enforce room quotas before create (see room-hub).
 */
export function ensureRoomForApiKey(accountId, apiKeyId, { instanceKey, label } = {}) {
  if (!accountId || !apiKeyId) return null;
  const database = getDb();
  const key = (instanceKey || 'default').trim() || 'default';
  const keyLabel = connectionLabelForApiKey(apiKeyId);
  const resolvedLabel = keyLabel || label || null;
  let row = peekRoomDockByApiKey(apiKeyId);
  if (row) {
    if (row.account_id !== accountId) {
      return null;
    }
    database.prepare(
      `UPDATE room_docks SET last_seen_at = datetime('now'),
        instance_key = ?,
        label = COALESCE(?, label)
       WHERE api_key_id = ?`
    ).run(key, resolvedLabel, apiKeyId);
    if (resolvedLabel) {
      database.prepare('UPDATE rooms SET label = ? WHERE id = ?').run(resolvedLabel, row.room_id);
    }
    return getRoom(row.room_id);
  }

  const roomId = uuidv4();
  const roomLabel = resolvedLabel || defaultInstanceLabel(key);
  database.prepare('INSERT INTO rooms (id, account_id, label) VALUES (?, ?, ?)').run(roomId, accountId, roomLabel);
  database.prepare(
    `INSERT INTO room_docks (room_id, account_id, api_key_id, instance_key, label, last_seen_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(roomId, accountId, apiKeyId, key, roomLabel);
  return getRoom(roomId);
}

/** @deprecated Prefer ensureRoomForApiKey. */
export function ensureRoomForInstance(accountId, instanceKey, label, apiKeyId = null) {
  if (apiKeyId) {
    return ensureRoomForApiKey(accountId, apiKeyId, { instanceKey, label });
  }
  return null;
}

/** Persist label sync when a dock key is known for a room (reconnect backfill). */
export function setRoomDockApiKey(roomId, apiKeyId) {
  if (!roomId || !apiKeyId) return false;
  const label = connectionLabelForApiKey(apiKeyId);
  const database = getDb();
  const byKey = peekRoomDockByApiKey(apiKeyId);
  if (byKey && byKey.room_id !== roomId) {
    // Key already owns another room — do not reassign.
    return false;
  }
  const dock = database.prepare('SELECT * FROM room_docks WHERE room_id = ?').get(roomId);
  if (!dock) return false;
  database.prepare(
    `UPDATE room_docks SET api_key_id = ?, label = COALESCE(?, label), last_seen_at = datetime('now')
     WHERE room_id = ?`
  ).run(apiKeyId, label, roomId);
  if (label) {
    database.prepare('UPDATE rooms SET label = ? WHERE id = ?').run(label, roomId);
  }
  return true;
}

export function touchRoomDockByApiKey(apiKeyId, instanceKey) {
  if (!apiKeyId) return;
  const key = (instanceKey || 'default').trim() || 'default';
  getDb().prepare(
    `UPDATE room_docks SET last_seen_at = datetime('now'), instance_key = ?
     WHERE api_key_id = ?`
  ).run(key, apiKeyId);
}

/** @deprecated Prefer touchRoomDockByApiKey. */
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
    const apiKey = dock?.api_key_id ? getApiKeyById(dock.api_key_id) : null;
    const apiKeyLabel = apiKey?.label || null;
    const connectionLabel = apiKeyLabel
      || (dock?.label && dock.label !== 'Main table' && dock.label !== 'Default Room' && dock.label !== 'Table'
        ? dock.label
        : null)
      || (room.label && room.label !== 'Main table' && room.label !== 'Default Room'
        ? room.label
        : null)
      || 'Unassigned connection';
    return {
      ...room,
      instance_key: dock?.instance_key || null,
      dock_label: connectionLabel,
      api_key_id: dock?.api_key_id || null,
      api_key_label: apiKeyLabel,
      last_seen_at: dock?.last_seen_at || null,
      guest_link_count: countActiveGuestTokensForRoom(room.id),
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

export function findDefaultDockOwnerGuestToken(roomId, accountId) {
  if (!roomId || !accountId) return null;
  return getDb().prepare(
    `SELECT * FROM room_guest_tokens
     WHERE room_id = ? AND account_id = ? AND revoked_at IS NULL AND label = ?
     ORDER BY created_at ASC
     LIMIT 1`
  ).get(roomId, accountId, OBS_DOCK_OWNER_GUEST_LABEL) || null;
}

export function isDefaultDockOwnerGuestToken(row) {
  return !!(row && String(row.label || '') === OBS_DOCK_OWNER_GUEST_LABEL);
}

/** One built-in guest scorer QR per table. Recreated after revoke-all. */
export function ensureDefaultDockOwnerGuestToken(roomId, accountId) {
  if (!roomId || !accountId) return null;
  const existing = findDefaultDockOwnerGuestToken(roomId, accountId);
  if (existing) return existing;
  const token = createGuestToken(roomId, accountId, OBS_DOCK_OWNER_GUEST_LABEL);
  return findGuestToken(token);
}

export function getRoomIdForApiKey(apiKeyId) {
  if (!apiKeyId) return null;
  const row = getDb().prepare(
    `SELECT room_id FROM room_docks WHERE api_key_id = ? LIMIT 1`
  ).get(apiKeyId);
  return row?.room_id || null;
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

/**
 * Upsert a roster player by UUID (preferred) or find/create by display name.
 * Returns the player id, or null if skipped.
 */
export function upsertAccountPlayer(accountId, name, playerId = null) {
  if (!accountId) return null;
  const display = truncatePlayerName(name);
  const normalized = normalizePlayerName(display);
  if (!normalized) return null;
  const database = getDb();

  if (playerId) {
    const existing = database.prepare(
      'SELECT id, account_id FROM account_players WHERE id = ?'
    ).get(playerId);
    if (existing && existing.account_id !== accountId) {
      return null;
    }
    database.prepare(
      `INSERT INTO account_players (id, account_id, name, name_normalized, last_seen_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         name_normalized = excluded.name_normalized,
         last_seen_at = datetime('now')`
    ).run(playerId, accountId, display, normalized);
    return playerId;
  }

  const byName = database.prepare(
    `SELECT id FROM account_players
     WHERE account_id = ? AND name_normalized = ?
     ORDER BY last_seen_at DESC
     LIMIT 1`
  ).get(accountId, normalized);
  if (byName?.id) {
    database.prepare(
      `UPDATE account_players
       SET name = ?, last_seen_at = datetime('now')
       WHERE id = ?`
    ).run(display, byName.id);
    return byName.id;
  }

  const id = uuidv4();
  database.prepare(
    `INSERT INTO account_players (id, account_id, name, name_normalized, last_seen_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(id, accountId, display, normalized);
  return id;
}

export function getAccountPlayer(accountId, playerId) {
  if (!accountId || !playerId) return null;
  return getDb().prepare(
    'SELECT id, account_id, name, name_normalized, last_seen_at FROM account_players WHERE id = ? AND account_id = ?'
  ).get(playerId, accountId) || null;
}

/** Full account roster (including players with no recorded matches). */
export function listAccountPlayers(accountId) {
  if (!accountId) return [];
  seedAccountPlayersFromSessions(accountId);
  return getDb().prepare(
    `SELECT id, name, last_seen_at FROM account_players
     WHERE account_id = ?
     ORDER BY name COLLATE NOCASE ASC`
  ).all(accountId);
}

export function upsertAccountPlayersFromState(accountId, state) {
  if (!accountId || !state || typeof state !== 'object') return;
  if (state.player1Name) {
    upsertAccountPlayer(accountId, state.player1Name, state.player1Id || null);
  }
  if (state.player2Name) {
    upsertAccountPlayer(accountId, state.player2Name, state.player2Id || null);
  }
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
      `SELECT id, name, last_seen_at FROM account_players
       WHERE account_id = ?
       ORDER BY last_seen_at DESC, name COLLATE NOCASE ASC
       LIMIT ?`
    ).all(accountId, max);
  }
  const like = `%${normalized}%`;
  return getDb().prepare(
    `SELECT id, name, last_seen_at FROM account_players
     WHERE account_id = ? AND (name_normalized LIKE ? OR LOWER(name) LIKE ?)
     ORDER BY
       CASE WHEN name_normalized = ? THEN 0 WHEN name_normalized LIKE ? THEN 1 ELSE 2 END,
       last_seen_at DESC,
       name COLLATE NOCASE ASC
     LIMIT ?`
  ).all(accountId, like, like, normalized, `${normalized}%`, max);
}

/** Pull player ids/names from recorded session:start events into the roster.
 *  Assigns UUIDs to name-only payloads (dev greenfield / older fixtures). */
export function syncAccountPlayersFromMatchEvents(accountId) {
  if (!accountId) return;
  const rows = getDb().prepare(
    `SELECT e.id, e.payload
     FROM match_events e
     WHERE e.account_id = ?
       AND e.event_type = 'session:start'`
  ).all(accountId);
  for (const row of rows) {
    let payload = {};
    try {
      payload = JSON.parse(row.payload || '{}');
    } catch {
      payload = {};
    }
    let changed = false;
    if (payload.player1) {
      const id = upsertAccountPlayer(accountId, payload.player1, payload.player1Id || null);
      if (id && payload.player1Id !== id) {
        payload.player1Id = id;
        changed = true;
      }
    }
    if (payload.player2) {
      const id = upsertAccountPlayer(accountId, payload.player2, payload.player2Id || null);
      if (id && payload.player2Id !== id) {
        payload.player2Id = id;
        changed = true;
      }
    }
    if (changed) {
      getDb().prepare(
        `UPDATE match_events SET payload = ? WHERE id = ? AND account_id = ?`
      ).run(JSON.stringify(payload), row.id, accountId);
    }
  }
}

/** Update roster display name for a player UUID. Match payloads are updated separately. */
export function renameAccountPlayerRoster(accountId, playerId, toName) {
  if (!accountId || !playerId) return false;
  const toDisplay = truncatePlayerName(toName);
  const toNorm = normalizePlayerName(toDisplay);
  if (!toNorm) return false;
  const result = getDb().prepare(
    `UPDATE account_players
     SET name = ?, name_normalized = ?, last_seen_at = datetime('now')
     WHERE id = ? AND account_id = ?`
  ).run(toDisplay, toNorm, playerId, accountId);
  return result.changes > 0;
}

/** Remove a player from the account roster. Match events are deleted separately. */
export function deleteAccountPlayerRoster(accountId, playerId) {
  if (!accountId || !playerId) return false;
  const result = getDb().prepare(
    'DELETE FROM account_players WHERE id = ? AND account_id = ?'
  ).run(playerId, accountId);
  return result.changes > 0;
}
