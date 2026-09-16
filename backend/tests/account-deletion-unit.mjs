#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuesport-account-delete-'));
process.env.SQLITE_PATH = path.join(tempDir, 'test.db');
process.env.ALLOW_DEV_AUTH = 'true';
process.env.DEV_AUTH_SECRET = 'account-deletion-unit-test-secret';
process.env.ACCOUNT_FINGERPRINT_SECRET = 'account-fingerprint-unit-test-secret';

let failed = 0;
let database = null;
function assert(name, condition) {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

try {
  const sqlite = await import('../src/db/sqlite.js');
  const email = 'Delete.Me@Example.com';
  const { account } = sqlite.ensureAccount(email, 'auth-user-delete-test');
  const db = sqlite.getDb();
  database = db;

  db.prepare('INSERT INTO rooms (id, account_id, label) VALUES (?, ?, ?)').run('delete-room', account.id, 'Delete room');
  db.prepare(
    `INSERT INTO room_guest_tokens (token, room_id, account_id, label)
     VALUES (?, ?, ?, ?)`
  ).run('delete-guest', 'delete-room', account.id, 'Delete guest');
  sqlite.createApiKey(account.id, 'Delete key', 'trusted_operator');
  sqlite.recordEmailTrialUse(email);

  const deleting = sqlite.markAccountDeleting(account.id);
  assert('account enters deleting state', deleting?.deletion_status === 'deleting');
  assert('deletion invalidates sessions', Number(deleting?.session_epoch) > Number(account.session_epoch));

  sqlite.setAccountDeletionError(account.id, 'retry me');
  assert('deletion error remains retryable', sqlite.getAccountById(account.id)?.deletion_error === 'retry me');

  const deleted = sqlite.finalizeAccountDeletion(account.id, {
    blockFutureSignups: true,
    trialUsed: true,
  });
  assert('account deletion completes', deleted === true && !sqlite.getAccountById(account.id));
  assert('account children cascade', db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE account_id = ?').get(account.id).n === 0);
  assert('trial use survives deletion', sqlite.hasEmailUsedTrial(email));
  assert('optional signup block survives deletion', sqlite.isEmailBlocked(email));
  assert('deleted Supabase identity is tombstoned', sqlite.isAuthUserDeleted('auth-user-delete-test'));

  let blocked = false;
  try {
    sqlite.ensureAccount(email, 'replacement-auth-user');
  } catch (error) {
    blocked = error?.code === 'account_blocked';
  }
  assert('blocked email cannot recreate an account', blocked);
  assert('exact email can be unblocked', sqlite.unblockAccountEmail(email));
  let staleIdentityBlocked = false;
  try {
    sqlite.ensureAccount(email, 'auth-user-delete-test');
  } catch (error) {
    staleIdentityBlocked = error?.code === 'account_deleted';
  }
  assert('stale JWT identity cannot recreate the deleted account', staleIdentityBlocked);
  assert('unblocked email can create a new inactive account', !!sqlite.ensureAccount(email, 'replacement-auth-user').account);
  assert('unblocking does not restore trial eligibility', sqlite.hasEmailUsedTrial(email));
} finally {
  if (database?.open) database.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
