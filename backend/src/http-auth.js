import { isDevAuthConfigured, resolveDevAccountFromToken } from './dev-auth.js';

export function authErrorBody(code, message) {
  return { code, message, error: message };
}

export function authFailure(status, code, message) {
  return { failure: { status, code, message } };
}

export function replyAuthFailure(reply, failure) {
  return reply.code(failure.status).send(authErrorBody(failure.code, failure.message));
}

/** Resolve account from Authorization: Bearer … header. */
export async function resolveBearerAccount(request) {
  const auth = request.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return authFailure(401, 'auth_required', 'Authorization required');
  }
  const token = auth.slice(7).trim();
  if (!token) {
    return authFailure(401, 'auth_required', 'Authorization required');
  }

  if (token.startsWith('dev:')) {
    if (!isDevAuthConfigured()) {
      return authFailure(401, 'invalid_token', 'Dev auth is not configured on this server');
    }
    const account = resolveDevAccountFromToken(token);
    if (!account) {
      return authFailure(401, 'invalid_token', 'Invalid or expired dev token — sign in again');
    }
    return { account };
  }

  const { authenticateJoin } = await import('./ws/auth.js');
  const result = await authenticateJoin({ accessToken: token, client: 'mobile' });
  if (result.error) {
    const status = result.error === 'subscription_required' ? 403 : 401;
    return authFailure(status, result.error, result.message || result.error);
  }
  return { account: result.account };
}

/** @deprecated Use resolveBearerAccount — returns account or null */
export async function resolveAccountFromRequest(request) {
  const result = await resolveBearerAccount(request);
  if (result.failure) return null;
  return result.account;
}
