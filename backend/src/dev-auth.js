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

export function issueDevToken(accountId) {
  const sig = crypto.createHmac('sha256', config.devAuthSecret)
    .update(`dev-token:${accountId}`)
    .digest('base64url');
  return `dev:${accountId}.${sig}`;
}

export function parseDevToken(token) {
  if (!token || !token.startsWith('dev:') || !isDevAuthConfigured()) return null;
  const body = token.slice(4);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return null;
  const accountId = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  if (!accountId || !sig) return null;
  const expected = crypto.createHmac('sha256', config.devAuthSecret)
    .update(`dev-token:${accountId}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  return accountId;
}

export function resolveDevAccountFromToken(token) {
  const accountId = parseDevToken(token);
  if (!accountId) return null;
  return sqlite.getAccountById(accountId);
}
