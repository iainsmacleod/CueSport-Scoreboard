import { config } from '../config.js';

/**
 * Platform admin = Google/account email on PLATFORM_ADMIN_EMAILS allowlist.
 * Independent of per-tenant Dock Key roles (administrator / trusted_operator).
 */
export function isPlatformAdmin(account) {
  const email = String(account?.email || '').trim().toLowerCase();
  if (!email) return false;
  return config.platformAdminEmails.includes(email);
}
