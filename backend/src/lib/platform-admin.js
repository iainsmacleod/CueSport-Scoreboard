import { config } from '../config.js';

/**
 * Platform admin = Google/account email on PLATFORM_ADMIN_EMAILS allowlist.
 * Independent of per-tenant Dock Key roles (administrator / trusted_operator).
 */
export function isPlatformAdmin(account) {
  // Platform Admin is a managed multi-tenant support role. A self-hosted
  // deployment has one owner account and delegates access with Dock Keys.
  if (config.allowDevAuth) return false;
  const email = String(account?.email || '').trim().toLowerCase();
  if (!email) return false;
  return config.platformAdminEmails.includes(email);
}
