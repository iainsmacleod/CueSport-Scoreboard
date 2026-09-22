import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let adminClient = null;

function isMissingUserError(error) {
  const status = Number(error?.status);
  const text = String(error?.message || '').toLowerCase();
  return status === 404 || text.includes('user not found') || text.includes('not found');
}

export function isSupabaseAdminConfigured() {
  return !!(config.supabaseUrl && config.supabaseSecretKey);
}

export function getSupabaseAdmin() {
  if (!isSupabaseAdminConfigured()) return null;
  if (!adminClient) {
    adminClient = createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return adminClient;
}

/** Delete a Supabase Auth identity. Missing/already-deleted users are successful. */
export async function deleteSupabaseAuthUser(authUserId) {
  if (!authUserId) return { deleted: false, skipped: true };
  const client = getSupabaseAdmin();
  if (!client) {
    throw new Error('Supabase admin is not configured (set SUPABASE_URL and SUPABASE_SECRET_KEY)');
  }
  const { error } = await client.auth.admin.deleteUser(authUserId);
  if (error && !isMissingUserError(error)) throw error;
  return { deleted: !error, alreadyMissing: !!error };
}
