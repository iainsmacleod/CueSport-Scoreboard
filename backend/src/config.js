import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseEnvMs(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  dbDriver: process.env.DB_DRIVER || 'sqlite',
  sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'cuesport.db'),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || '',
  allowDevAuth: process.env.ALLOW_DEV_AUTH !== 'false',
  devAuthSecret: process.env.DEV_AUTH_SECRET || '',
  devAuthAccountEmail: (process.env.DEV_AUTH_ACCOUNT_EMAIL || '').trim(),
  tierDefault: process.env.TIER_DEFAULT || '',
  /** After last dock leaves a room, wait this long before deleting the room row. */
  roomCleanupGraceMs: parseEnvMs(process.env.ROOM_CLEANUP_GRACE_MS, 45 * 60 * 1000),
  /** Delete mapped rooms whose last_seen_at is older than this (even if grace already passed). */
  roomIdleTtlMs: parseEnvMs(process.env.ROOM_IDLE_TTL_MS, 14 * 24 * 60 * 60 * 1000),
  /** How often the sweeper looks for rooms to prune. */
  roomCleanupSweeperMs: parseEnvMs(process.env.ROOM_CLEANUP_SWEEPER_MS, 10 * 60 * 1000),
  isSupabase: () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
};
