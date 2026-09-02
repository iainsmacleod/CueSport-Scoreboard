import crypto from 'crypto';
import { config } from './config.js';
import * as sqlite from './db/sqlite.js';

export function isDevAuthConfigured() {
  return config.allowDevAuth && config.devAuthSecret.length > 0;
}

export function validateDevSecret(provided) {
  if (!isDevAuthConfigured()) return false;
  const a = crypto.createHash('sha256').update(String(provided || '')).digest();
  const b = crypto.createHash('sha256').update(config.devAuthSecret).digest();
  return crypto.timingSafeEqual(a, b);
}

export function ensureDevAccount() {
  return sqlite.ensureAccountWithRoom(config.devAuthAccountEmail);
}

function tokenEpoch(account) {
  const n = parseInt(account?.session_epoch, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function issueDevToken(account) {
  const accountId = typeof account === 'string' ? account : account.id;
  const epoch = typeof account === 'string'
    ? tokenEpoch(sqlite.getAccountById(accountId))
    : tokenEpoch(account);
  const sig = crypto.createHmac('sha256', config.devAuthSecret)
    .update(`dev-token:${accountId}:${epoch}`)
    .digest('base64url');
  return `dev:${accountId}:${epoch}.${sig}`;
}

/**
 * Parse and verify a signed dev token.
 * Formats:
 *   New:   dev:{accountId}:{epoch}.{sig}
 *   Legacy:dev:{accountId}.{sig}  (treated as epoch 1)
 */
export function parseDevToken(token) {
  if (!token || !token.startsWith('dev:') || !isDevAuthConfigured()) return null;
  const body = token.slice(4);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return null;
  const left = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  if (!left || !sig) return null;

  let accountId;
  let epoch;
  const colon = left.lastIndexOf(':');
  if (colon > 0) {
    accountId = left.slice(0, colon);
    epoch = parseInt(left.slice(colon + 1), 10);
  } else {
    accountId = left;
    epoch = 1;
  }
  if (!accountId || !Number.isFinite(epoch) || epoch < 1) return null;

  const expected = crypto.createHmac('sha256', config.devAuthSecret)
    .update(`dev-token:${accountId}:${epoch}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  return { accountId, epoch };
}

export function resolveDevAccountFromToken(token) {
  const parsed = parseDevToken(token);
  if (!parsed) return null;
  const account = sqlite.getAccountById(parsed.accountId);
  if (!account) return null;
  if (parsed.epoch < tokenEpoch(account)) return null;
  return account;
}
