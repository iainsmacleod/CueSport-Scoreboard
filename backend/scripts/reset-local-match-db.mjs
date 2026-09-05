/**
 * Wipe local CueSport Cloud match history so you can re-test stale sessions.
 * Keeps accounts, rooms, API keys, and guest tokens.
 *
 * Usage (from backend/): node scripts/reset-local-match-db.mjs
 * Prefer stopping the server first when possible.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.join(dataDir, 'cuesport.db');

if (!fs.existsSync(dbPath)) {
  console.error('No database at', dbPath);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(dataDir, `cuesport.backup-${stamp}.db`);
fs.copyFileSync(dbPath, backupPath);
console.log('Backup:', backupPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const before = {
  match_events: db.prepare('SELECT COUNT(*) AS n FROM match_events').get().n,
  room_sessions: db.prepare('SELECT COUNT(*) AS n FROM room_sessions').get().n,
  account_players: db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='account_players'"
  ).get().n
    ? db.prepare('SELECT COUNT(*) AS n FROM account_players').get().n
    : 0,
};

const tx = db.transaction(() => {
  db.exec('DELETE FROM match_events');
  try {
    db.exec('DELETE FROM live_streams');
  } catch (_) { /* optional table */ }
  try {
    db.exec("UPDATE room_sessions SET session_id = NULL, state = '{}'");
  } catch (_) { /* optional */ }
  try {
    db.exec('DELETE FROM account_players');
  } catch (_) { /* optional */ }
});
tx();

db.exec('VACUUM');
db.close();

console.log('Cleared match history. Before:', before);
console.log('Accounts / rooms / API keys kept. Restart the backend if it was running.');
console.log('Also clear dock IndexedDB via Stats → Clear all stats if local dock history matters.');
