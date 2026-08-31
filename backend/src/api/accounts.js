import * as sqlite from '../db/sqlite.js';
import { ensureAccountFromOAuth } from '../ws/auth.js';
import { config } from '../config.js';

export async function registerAccountRoutes(app) {
  /** Dev login — returns JWT-like dev token when Supabase not configured */
  app.post('/api/auth/dev-login', async (request, reply) => {
    if (!config.allowDevAuth) {
      return reply.code(403).send({ error: 'Dev auth disabled' });
    }
    const { email } = request.body || {};
    if (!email || typeof email !== 'string') {
      return reply.code(400).send({ error: 'email required' });
    }
    const { account, room } = sqlite.ensureAccountWithRoom(email.trim());
    let apiKey = sqlite.getApiKeysForAccount(account.id)[0];
    let apiKeyPlain = null;
    if (!apiKey) {
      const created = sqlite.createApiKey(account.id);
      apiKeyPlain = created.plaintext;
    }
    return {
      access_token: `dev:${account.email}`,
      account: { id: account.id, email: account.email, subscription_status: account.subscription_status },
      room: { id: room.id, label: room.label },
      api_key: apiKeyPlain,
    };
  });

  app.get('/api/auth/callback', async (request, reply) => {
    // Supabase OAuth redirects here with hash; serve page that extracts tokens
    return reply.redirect('/web/dashboard/?auth=callback');
  });

  app.get('/api/me', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const rooms = sqlite.getRoomsForAccount(account.id);
    const keys = sqlite.getApiKeysForAccount(account.id);
    return {
      account: {
        id: account.id,
        email: account.email,
        subscription_status: account.subscription_status,
        subscription_tier: account.subscription_tier,
      },
      rooms,
      api_keys: keys,
    };
  });

  app.post('/api/rooms', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { label } = request.body || {};
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    sqlite.getDb().prepare('INSERT INTO rooms (id, account_id, label) VALUES (?, ?, ?)').run(
      id, account.id, label || 'Room'
    );
    return sqlite.getRoom(id);
  });

  app.post('/api/api-keys', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { label } = request.body || {};
    const created = sqlite.createApiKey(account.id, label || 'API Key');
    return { id: created.id, key: created.plaintext, label: label || 'API Key' };
  });

  app.get('/api/config/public', async () => ({
    publicUrl: config.publicUrl,
    supabaseUrl: config.supabaseUrl || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    allowDevAuth: config.allowDevAuth,
  }));
}

async function resolveAccountFromRequest(request) {
  const auth = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  if (token.startsWith('dev:')) {
    const email = token.slice(4);
    const { account } = sqlite.ensureAccountWithRoom(email);
    return account;
  }

  const { authenticateJoin } = await import('../ws/auth.js');
  const result = await authenticateJoin({ accessToken: token, client: 'mobile' });
  if (result.error) return null;
  return result.account;
}

export { resolveAccountFromRequest };
