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
  /** Publishable key (`sb_publishable_…`) — browser OAuth + server createClient (non-admin). */
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  /** Secret key (`sb_secret_…`) — server-only; never pass to browser createClient / public config. */
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || '',
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || '',
  /**
   * Google OAuth Web Client ID (same client as Supabase Auth → Google provider).
   * Used by the official GIS Sign in with Google button on the dashboard.
   * Public — exposed via /api/config/public.
   */
  googleOAuthClientId: (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
  allowDevAuth: process.env.ALLOW_DEV_AUTH !== 'false',
  devAuthSecret: process.env.DEV_AUTH_SECRET || '',
  devAuthAccountEmail: (process.env.DEV_AUTH_ACCOUNT_EMAIL || '').trim(),
  tierDefault: process.env.TIER_DEFAULT || '',
  /**
   * Comma-separated Google account emails allowed to use /api/admin and the Admin dashboard tab.
   * Compared case-insensitively to accounts.email.
   */
  platformAdminEmails: String(process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  /** After last dock leaves a room, wait this long before deleting the room row. */
  roomCleanupGraceMs: parseEnvMs(process.env.ROOM_CLEANUP_GRACE_MS, 45 * 60 * 1000),
  /** Delete mapped rooms whose last_seen_at is older than this (even if grace already passed). */
  roomIdleTtlMs: parseEnvMs(process.env.ROOM_IDLE_TTL_MS, 14 * 24 * 60 * 60 * 1000),
  /** How often the sweeper looks for rooms to prune. */
  roomCleanupSweeperMs: parseEnvMs(process.env.ROOM_CLEANUP_SWEEPER_MS, 10 * 60 * 1000),
  /** Stripe (managed cloud billing). Leave empty on self-host. */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePriceStreamer: process.env.STRIPE_PRICE_STREAMER || '',
  stripePriceTournamentOrganizer: process.env.STRIPE_PRICE_TOURNAMENT_ORGANIZER || '',
  stripePriceLeagueDirector: process.env.STRIPE_PRICE_LEAGUE_DIRECTOR || '',
  stripeTrialDays: Math.max(0, parseInt(process.env.STRIPE_TRIAL_DAYS || '14', 10) || 14),
  billingContactUrl: process.env.BILLING_CONTACT_URL || '',
  supportIssuesUrl: process.env.SUPPORT_ISSUES_URL
    || 'https://github.com/iainsmacleod/CueSport-Scoreboard/issues',
  legalContactEmail: process.env.LEGAL_CONTACT_EMAIL || '',
  legalEntityName: process.env.LEGAL_ENTITY_NAME || 'CueSport Scoreboard Cloud',
  legalGoverningLaw: process.env.LEGAL_GOVERNING_LAW || '[Operator province/country — fill before publish]',
  /** Google / Supabase Auth is usable when URL + publishable key are set. */
  isSupabase: () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY),
};
