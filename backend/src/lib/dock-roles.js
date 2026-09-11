/** OBS Dock Key roles — seats, not the Cloud account. */

export const DOCK_KEY_ROLES = ['administrator', 'trusted_operator', 'operator'];
export const DEFAULT_DOCK_KEY_ROLE = 'trusted_operator';
export const OBS_DOCK_OWNER_GUEST_LABEL = 'OBS Dock Owner';

export const DOCK_KEY_ROLE_LABELS = {
  administrator: 'Administrator',
  trusted_operator: 'Trusted Operator',
  operator: 'Operator',
};

export function isValidDockKeyRole(role) {
  return DOCK_KEY_ROLES.includes(String(role || '').trim());
}

export function normalizeDockKeyRole(role) {
  const raw = String(role || '').trim();
  return isValidDockKeyRole(raw) ? raw : DEFAULT_DOCK_KEY_ROLE;
}

export function isAccountAdminAuth(auth) {
  return !!(auth && (auth.authMethod === 'jwt' || auth.authMethod === 'dev'));
}

export function effectiveDockRole(auth) {
  if (!auth) return 'operator';
  if (isAccountAdminAuth(auth)) return 'administrator';
  return normalizeDockKeyRole(auth.role);
}

export function permissionsForAuth(auth) {
  const accountAdmin = isAccountAdminAuth(auth);
  const role = effectiveDockRole(auth);
  return {
    role: accountAdmin ? null : role,
    authMethod: auth?.authMethod || null,
    keyId: auth?.keyId || null,
    canManageKeys: accountAdmin,
    canEditAnyMatch: accountAdmin || role === 'administrator',
    canEditOwnMatch: accountAdmin || role === 'administrator' || role === 'trusted_operator',
    canManagePlayers: accountAdmin || role === 'administrator',
    canCreateGuestLinks: accountAdmin || role === 'administrator' || role === 'trusted_operator',
    canRevokeGuestLinks: accountAdmin || role === 'administrator' || role === 'trusted_operator',
    canRevokeDefaultGuestLink: accountAdmin,
  };
}

export function canMutateMatch(auth, startApiKeyId) {
  const perms = permissionsForAuth(auth);
  if (perms.canEditAnyMatch) return true;
  if (!perms.canEditOwnMatch) return false;
  if (!auth?.keyId || !startApiKeyId) return false;
  return String(startApiKeyId) === String(auth.keyId);
}
