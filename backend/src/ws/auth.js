import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import * as sqlite from '../db/sqlite.js';

let supabase = null;
let jwks = null;

function getSupabase() {
  if (!supabase && config.isSupabase()) {
    supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

async function verifySupabaseJwt(token) {
  if (!token) return null;
  if (config.supabaseJwtSecret) {
    const secret = new TextEncoder().encode(config.supabaseJwtSecret);
    const { payload } = await jwtVerify(token, secret);
    return payload;
  }
  if (config.supabaseUrl) {
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`));
    }
    const { payload } = await jwtVerify(token, jwks);
    return payload;
  }
  return null;
}

/**
 * Resolve account from API key or JWT access token.
 * Returns { account, roomId?, authMethod: 'api_key'|'jwt' }
 */
export async function authenticateJoin({ apiKey, accessToken, roomId, client }) {
  if (apiKey) {
    const result = sqlite.findAccountByApiKey(apiKey);
    if (!result) {
      return { error: 'invalid_api_key', message: 'Invalid or revoked API key' };
    }
    if (roomId && !sqlite.roomBelongsToAccount(roomId, result.account.id)) {
      return { error: 'room_forbidden', message: 'API key does not have access to this room' };
    }
    if (client === 'mobile' && result.account.subscription_status !== 'active') {
      return { error: 'subscription_required', message: 'Mobile control requires CueSport Cloud Pro' };
    }
    return { account: result.account, authMethod: 'api_key' };
  }

  if (accessToken) {
    // Dev tokens are not JWTs — never pass them to JWT verification
    if (accessToken.startsWith('dev:')) {
      if (!config.allowDevAuth) {
        return { error: 'invalid_token', message: 'Dev auth is disabled on this server' };
      }
      const email = accessToken.slice(4);
      if (!email) {
        return { error: 'invalid_token', message: 'Invalid dev token' };
      }
      const { account } = sqlite.ensureAccountWithRoom(email);
      if (roomId && !sqlite.roomBelongsToAccount(roomId, account.id)) {
        return { error: 'room_forbidden', message: 'No access to this room' };
      }
      if (client === 'mobile' && account.subscription_status !== 'active') {
        return { error: 'subscription_required', message: 'Mobile control requires CueSport Cloud Pro' };
      }
      return { account, authMethod: 'dev' };
    }

    let payload = null;
    try {
      payload = await verifySupabaseJwt(accessToken);
    } catch {
      return { error: 'invalid_token', message: 'Invalid access token' };
    }

    const sub = payload?.sub;
    if (!sub) {
      return { error: 'invalid_token', message: 'Invalid access token' };
    }
    const email = payload.email || payload.user_metadata?.email || `${sub}@supabase.local`;

    let account = sqlite.getAccountByAuthUserId(sub);
    if (!account) {
      const ensured = sqlite.ensureAccountWithRoom(email, sub);
      account = ensured.account;
    }

    if (roomId && !sqlite.roomBelongsToAccount(roomId, account.id)) {
      return { error: 'room_forbidden', message: 'No access to this room' };
    }
    if (client === 'mobile' && account.subscription_status !== 'active') {
      return { error: 'subscription_required', message: 'Mobile control requires CueSport Cloud Pro' };
    }
    return { account, authMethod: 'jwt' };
  }

  if (config.allowDevAuth) {
    return { error: 'auth_required', message: 'Provide api_key or access_token' };
  }
  return { error: 'auth_required', message: 'Authentication required' };
}

export async function ensureAccountFromOAuth(email, authUserId) {
  return sqlite.ensureAccountWithRoom(email, authUserId);
}

export { getSupabase };
