/**
 * Persist + auto-refresh Supabase Auth for CueSport Cloud web apps.
 * Keeps localStorage `cuesport_token` in sync with session.access_token so
 * existing getToken() / Bearer call sites keep working.
 */
export const CUESPORT_TOKEN_KEY = 'cuesport_token';
const SUPABASE_STORAGE_KEY = 'cuesport-supabase-auth';
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

let clientPromise = null;
let clientConfigKey = '';
let authListenerBound = false;

export function getStoredAccessToken() {
  return localStorage.getItem(CUESPORT_TOKEN_KEY) || '';
}

export function setStoredAccessToken(token) {
  const value = String(token || '').trim();
  if (value) {
    localStorage.setItem(CUESPORT_TOKEN_KEY, value);
  } else {
    localStorage.removeItem(CUESPORT_TOKEN_KEY);
  }
}

function configKey(config) {
  return `${config?.supabaseUrl || ''}|${config?.supabasePublishableKey || ''}`;
}

function canUseSupabase(config) {
  return !!(config?.supabaseUrl && config?.supabasePublishableKey);
}

/**
 * @param {{ supabaseUrl?: string, supabasePublishableKey?: string }} config
 */
export async function getSupabaseClient(config) {
  if (!canUseSupabase(config)) {
    throw new Error('Supabase is not configured on this server');
  }
  const key = configKey(config);
  if (clientPromise && clientConfigKey === key) {
    return clientPromise;
  }
  clientConfigKey = key;
  clientPromise = (async () => {
    const { createClient } = await import(SUPABASE_JS_URL);
    return createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: SUPABASE_STORAGE_KEY,
      },
    });
  })();
  return clientPromise;
}

/**
 * Bind onAuthStateChange once so TOKEN_REFRESHED keeps cuesport_token fresh.
 * @param {{ supabaseUrl?: string, supabasePublishableKey?: string }} config
 */
export async function ensureSupabaseAuth(config) {
  if (!canUseSupabase(config)) return null;
  const supabase = await getSupabaseClient(config);
  if (!authListenerBound) {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        setStoredAccessToken(session.access_token);
      } else if (event === 'SIGNED_OUT') {
        setStoredAccessToken('');
      }
    });
    authListenerBound = true;
  }
  // Hydrate / refresh persisted session into cuesport_token.
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) {
      setStoredAccessToken(data.session.access_token);
    }
  } catch (_) { /* ignore */ }
  return supabase;
}

/**
 * Google Identity Services → Supabase session (persisted + refreshable).
 * @returns {Promise<string>} access_token
 */
export async function signInWithGoogleIdToken(config, credential) {
  const supabase = await ensureSupabaseAuth(config);
  if (!supabase) throw new Error('Supabase is not configured on this server');
  if (!credential) throw new Error('Google sign-in did not return a credential');
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: credential,
  });
  if (error) throw error;
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw new Error('No session returned from Google sign-in');
  setStoredAccessToken(accessToken);
  return accessToken;
}

/**
 * Adopt OAuth redirect hash tokens into a persisted Supabase session.
 * @returns {Promise<string|null>} access_token when adopted
 */
export async function adoptOAuthHashSession(config) {
  if (!canUseSupabase(config)) return null;
  const hash = String(window.location.hash || '').replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken) return null;

  const supabase = await ensureSupabaseAuth(config);
  if (refreshToken && supabase) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (!error && data?.session?.access_token) {
      setStoredAccessToken(data.session.access_token);
      return data.session.access_token;
    }
  }
  // Fallback: access token only (will expire until next full sign-in).
  setStoredAccessToken(accessToken);
  return accessToken;
}

/**
 * Best-effort fresh access token for API / WS.
 * Dev tokens (no Supabase session) are returned as stored.
 */
export async function getFreshAccessToken(config) {
  const stored = getStoredAccessToken();
  if (!canUseSupabase(config)) return stored;
  if (stored.startsWith('dev:')) return stored;

  try {
    const supabase = await ensureSupabaseAuth(config);
    if (!supabase) return stored;
    let { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    let session = data?.session || null;

    // Proactively refresh when close to expiry (2 minutes).
    const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
    if (session && expiresAtMs && expiresAtMs - Date.now() < 120000) {
      const refreshed = await supabase.auth.refreshSession();
      if (!refreshed.error && refreshed.data?.session) {
        session = refreshed.data.session;
      }
    }

    if (session?.access_token) {
      setStoredAccessToken(session.access_token);
      return session.access_token;
    }
  } catch (_) { /* fall through */ }
  return getStoredAccessToken();
}

/** Clear Supabase session and cuesport_token (local sign-out). */
export async function signOutSupabaseSession(config) {
  setStoredAccessToken('');
  if (!canUseSupabase(config)) return;
  try {
    const supabase = await getSupabaseClient(config);
    await supabase.auth.signOut();
  } catch (_) { /* ignore */ }
}
