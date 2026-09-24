#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuesport-comp-expiry-'));
process.env.SQLITE_PATH = path.join(tempDir, 'test.db');
process.env.ALLOW_DEV_AUTH = 'true';
process.env.DEV_AUTH_SECRET = 'complimentary-expiry-unit-test-secret';
process.env.ACCOUNT_FINGERPRINT_SECRET = 'account-fingerprint-unit-test-secret';

let failed = 0;
function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

try {
  const sqlite = await import('../src/db/sqlite.js');
  const { enforceComplimentaryExpiryForAccount, sweepExpiredComplimentaryAccess } =
    await import('../src/lib/complimentary-expiry.js');

  const { account: expired } = sqlite.ensureAccount('expired-comp@example.com', 'auth-expired-comp');
  sqlite.getDb().prepare(
    `UPDATE accounts SET subscription_status = 'inactive', trial_ends_at = ? WHERE id = ?`
  ).run('2020-01-01T00:00:00.000Z', expired.id);
  const key = sqlite.createApiKey(expired.id, 'Expired key', 'trusted_operator');
  assert('expired account has active key before enforce', !!key?.id);

  const result = await enforceComplimentaryExpiryForAccount(expired.id);
  assert('enforce clears expired complimentary', !!result?.cleared);
  assert('enforce revokes keys when inactive', result?.keysRevoked?.includes(key.id));
  const after = sqlite.getAccountById(expired.id);
  assert('trial_ends_at cleared', after?.trial_ends_at == null);
  const keysLeft = sqlite.getDb().prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ? AND revoked_at IS NULL`
  ).get(expired.id);
  assert('no active keys remain', Number(keysLeft?.n) === 0);

  const { account: subscribed } = sqlite.ensureAccount('paid-comp@example.com', 'auth-paid-comp');
  sqlite.getDb().prepare(
    `UPDATE accounts SET subscription_status = 'active', trial_ends_at = ? WHERE id = ?`
  ).run('2020-01-01T00:00:00.000Z', subscribed.id);
  const paidKey = sqlite.createApiKey(subscribed.id, 'Paid key', 'trusted_operator');
  const paidResult = await enforceComplimentaryExpiryForAccount(subscribed.id);
  assert('subscribed account clears stale complimentary stamp', !!paidResult?.cleared);
  assert('subscribed account keeps Dock Keys', (paidResult?.keysRevoked || []).length === 0);
  const paidKeysLeft = sqlite.getDb().prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ? AND revoked_at IS NULL`
  ).get(subscribed.id);
  assert('paid key still active', Number(paidKeysLeft?.n) === 1, `key=${paidKey?.id}`);

  const { account: stripeEnded } = sqlite.ensureAccount('stripe-ended@example.com', 'auth-stripe-ended');
  sqlite.getDb().prepare(
    `UPDATE accounts SET subscription_status = 'inactive', trial_ends_at = NULL WHERE id = ?`
  ).run(stripeEnded.id);
  const endedKey = sqlite.createApiKey(stripeEnded.id, 'Ended sub key', 'trusted_operator');
  const { revokeDockKeysIfNoCloudAccess } = await import('../src/lib/complimentary-expiry.js');
  const stripeResult = await revokeDockKeysIfNoCloudAccess(stripeEnded.id);
  assert('inactive stripe account revokes keys', stripeResult.revoked && stripeResult.keysRevoked.includes(endedKey.id));

  const { account: stripeEndedComp } = sqlite.ensureAccount('stripe-ended-comp@example.com', 'auth-stripe-ended-comp');
  const futureComp = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  sqlite.getDb().prepare(
    `UPDATE accounts SET subscription_status = 'inactive', trial_ends_at = ? WHERE id = ?`
  ).run(futureComp, stripeEndedComp.id);
  const keptKey = sqlite.createApiKey(stripeEndedComp.id, 'Comp cover key', 'trusted_operator');
  const covered = await revokeDockKeysIfNoCloudAccess(stripeEndedComp.id);
  assert('complimentary still active keeps keys after stripe inactive', !covered.revoked);
  const coveredKeys = sqlite.getDb().prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ? AND revoked_at IS NULL`
  ).get(stripeEndedComp.id);
  assert('comp-covered key still active', Number(coveredKeys?.n) === 1, `key=${keptKey?.id}`);

  const { account: activeComp } = sqlite.ensureAccount('active-comp@example.com', 'auth-active-comp');
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  sqlite.getDb().prepare(
    `UPDATE accounts SET subscription_status = 'inactive', trial_ends_at = ? WHERE id = ?`
  ).run(future, activeComp.id);
  sqlite.createApiKey(activeComp.id, 'Active comp key', 'trusted_operator');
  const activeResult = await enforceComplimentaryExpiryForAccount(activeComp.id);
  assert('active complimentary not enforced early', activeResult == null);
  const activeKeys = sqlite.getDb().prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ? AND revoked_at IS NULL`
  ).get(activeComp.id);
  assert('active complimentary keys remain', Number(activeKeys?.n) === 1);

  const swept = await sweepExpiredComplimentaryAccess();
  assert('sweep is idempotent after enforce', Array.isArray(swept));

  console.log(failed ? `\n${failed} failed` : '\nAll complimentary-expiry unit checks passed');
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
