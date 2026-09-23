#!/usr/bin/env node
/**
 * Plan downgrade: tier comparison + seat reset (revoke docks, clear ad-hoc).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuesport-downgrade-'));
process.env.SQLITE_PATH = path.join(tempDir, 'test.db');
process.env.ALLOW_DEV_AUTH = 'true';
process.env.DEV_AUTH_SECRET = 'downgrade-unit-test-secret';
process.env.ACCOUNT_FINGERPRINT_SECRET = 'downgrade-fingerprint-secret';

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
  const quotas = await import('../src/quotas.js');
  const sqlite = await import('../src/db/sqlite.js');
  const { resetAccountSeatsForPlanDowngrade } = await import('../src/ws/room-hub.js');

  assert('streamer→to is not downgrade', !quotas.isTierDowngrade('streamer', 'tournament_organizer'));
  assert('to→streamer is downgrade', quotas.isTierDowngrade('tournament_organizer', 'streamer'));
  assert('same tier not downgrade', !quotas.isTierDowngrade('league_director', 'league_director'));
  assert('league→to is downgrade', quotas.isTierDowngrade('league_director', 'tournament_organizer'));
  assert('network→league is downgrade', quotas.isTierDowngrade('network_organization', 'league_director'));
  assert('unrestricted→streamer is downgrade', quotas.isTierDowngrade('unrestricted', 'streamer'));
  assert('streamer→unrestricted is not downgrade', !quotas.isTierDowngrade('streamer', 'unrestricted'));
  assert('to→streamer simulated downgrade', quotas.isTierDowngrade('tournament_organizer', 'streamer'));

  const { account } = sqlite.ensureAccount('downgrade@example.com', 'auth-downgrade-test');
  assert('account created', !!account?.id);

  const keyA = sqlite.createApiKey(account.id, 'Table A', 'operator');
  const keyB = sqlite.createApiKey(account.id, 'Table B', 'operator');
  assert('two dock keys created', !!keyA?.id && !!keyB?.id);

  sqlite.ensureRoomForApiKey(account.id, keyA.id, { instanceKey: 'default', label: 'A' });
  sqlite.ensureRoomForApiKey(account.id, keyB.id, { instanceKey: 'default', label: 'B' });
  const adhoc1 = sqlite.createImpromptuRoom(account.id, 'Side 1');
  const adhoc2 = sqlite.createImpromptuRoom(account.id, 'Side 2');
  assert('seeded seats', sqlite.countActiveApiKeys(account.id) === 2
    && sqlite.countDockRoomsForAccount(account.id) === 2
    && sqlite.countImpromptuRoomsForAccount(account.id) === 2
    && !!adhoc1?.id && !!adhoc2?.id);

  const reset = resetAccountSeatsForPlanDowngrade(account.id);
  assert('revoked both keys', reset.keysRevoked === 2, JSON.stringify(reset));
  assert('deleted both dock rooms', reset.dockRoomsDeleted === 2, JSON.stringify(reset));
  assert('deleted both ad-hoc rooms', reset.adhocDeleted === 2, JSON.stringify(reset));
  assert('no active keys remain', sqlite.countActiveApiKeys(account.id) === 0);
  assert('no dock rooms remain', sqlite.countDockRoomsForAccount(account.id) === 0);
  assert('no ad-hoc rooms remain', sqlite.countImpromptuRoomsForAccount(account.id) === 0);
} catch (err) {
  failed += 1;
  console.error('FAIL suite error', err);
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

if (failed) {
  console.error(`\n${failed} plan-downgrade check(s) failed`);
  process.exit(1);
}
console.log('\nAll plan-downgrade unit checks passed');
