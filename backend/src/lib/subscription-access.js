/**
 * Cloud access: Stripe subscription active/trialing, unexpired admin complimentary access,
 * or PLATFORM_ADMIN_EMAILS allowlist (ops — no plan required).
 * Paid tiers / product trials are owned by Stripe; trial_ends_at is complimentary-only (no card).
 */

import { isPlatformAdmin } from './platform-admin.js';

export function parseTrialEndsAtMs(trialEndsAt) {
  if (!trialEndsAt) return null;
  const raw = String(trialEndsAt).trim();
  if (!raw) return null;
  const iso = raw.includes('T')
    ? raw
    : `${raw.replace(' ', 'T')}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? '' : 'Z'}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function isAdminSupportTrialActive(account, nowMs = Date.now()) {
  const ends = parseTrialEndsAtMs(account?.trial_ends_at);
  return ends != null && ends > nowMs;
}

export function hasCloudSubscriptionAccess(account, nowMs = Date.now()) {
  if (isPlatformAdmin(account)) return true;
  const status = String(account?.subscription_status || '').toLowerCase();
  if (status === 'active' || status === 'trialing') return true;
  return isAdminSupportTrialActive(account, nowMs);
}
